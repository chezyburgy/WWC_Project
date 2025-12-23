# Requires: Docker Desktop with Docker Compose V2 (docker compose) or docker-compose

<#
.SYNOPSIS
 Runs the Event-Driven E-Commerce project in isolation using Docker Compose.

.DESCRIPTION
 This script wraps docker compose with a unique project name and profiles, so the
 stack is isolated from other Compose projects. It supports start/stop/status/logs,
 rebuild, and clean (remove containers, networks, and volumes for this project).

.PARAMETER Action
 One of: start | stop | restart | status | logs | down | clean | rebuild | config

.PARAMETER ProjectName
 Compose project name used for isolation. Defaults to a deterministic name based
 on the current folder (e.g., edem-project).

.PARAMETER Profiles
 Compose profiles to enable. Defaults to infra and app. Use "infra" for infra only
 or "app" to run only application layer. Accepts multiple values.

.PARAMETER Build
 If set with Action start/restart/rebuild, builds images before starting.

.EXAMPLE
 # Start everything (infra + app) with build
 ./run.ps1 -Action start -Build

.EXAMPLE
 # See status of this isolated stack
 ./run.ps1 -Action status

.EXAMPLE
 # Follow logs
 ./run.ps1 -Action logs

.EXAMPLE
 # Clean everything (containers, network, and volumes) for this project only
 ./run.ps1 -Action clean

Note: If you need multiple independent instances concurrently, specify distinct
ProjectName values. Host port mappings in docker-compose.yml are fixed; running
multiple instances simultaneously will cause port conflicts unless you adjust
ports or introduce overrides.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('start','stop','restart','status','logs','down','clean','rebuild','config')]
    [string]$Action,

    [string]$ProjectName,

    [string[]]$Profiles = @('infra','app'),

    [switch]$Build
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DeterministicProjectName {
    param([string]$BasePath)
    # Simple deterministic name based on folder name
    $folder = Split-Path -Leaf $BasePath
    if ([string]::IsNullOrWhiteSpace($folder)) { $folder = 'project' }
    return ('edem-' + ($folder -replace '[^a-zA-Z0-9]+','-')).ToLower()
}

function Ensure-DockerCompose {
    # Returns an object describing how to invoke compose
    # { Mode = 'v2'; Exe = 'docker'; Args = @('compose', ...) }
    try { $null = Get-Command docker -ErrorAction Stop } catch { throw 'Docker is not installed or not on PATH.' }

    $isV2 = $false
    try {
        $out = & docker compose version 2>$null
        if ($LASTEXITCODE -eq 0) { $isV2 = $true }
    } catch { $isV2 = $false }

    if ($isV2) {
        return @{ Mode = 'v2'; Exe = 'docker'; PreArgs = @('compose') }
    }

    # fallback to docker-compose
    try { $null = Get-Command docker-compose -ErrorAction Stop } catch { throw 'Docker Compose is not available (neither docker compose nor docker-compose).' }
    return @{ Mode = 'v1'; Exe = 'docker-compose'; PreArgs = @() }
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory=$true)][string[]]$Args
    )
    $compose = Ensure-DockerCompose
    $exe = $compose.Exe
    $pre = [string[]]$compose.PreArgs
    Write-Verbose ("Running: {0} {1}" -f $exe, (@($pre + $Args) -join ' '))
    & $exe @pre @Args
    if ($LASTEXITCODE -ne 0) { throw "Compose command failed with exit code $LASTEXITCODE" }
}

function Get-ComposeArgsBase {
    param(
        [string]$ProjectName,
        [string[]]$Profiles
    )
    $args = @()
    if ($ProjectName) { $args += @('-p', $ProjectName) }
    foreach ($p in $Profiles) {
        if (-not [string]::IsNullOrWhiteSpace($p)) {
            $args += @('--profile', $p)
        }
    }
    return ,$args
}

# Move to the directory containing this script (where docker-compose.yml resides)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir
try {
    $composeFile = Join-Path $scriptDir 'docker-compose.yml'
    if (-not (Test-Path $composeFile)) { throw "docker-compose.yml not found at $composeFile" }

    if (-not $ProjectName) { $ProjectName = Get-DeterministicProjectName -BasePath $scriptDir }

    $baseArgs = Get-ComposeArgsBase -ProjectName $ProjectName -Profiles $Profiles

    switch ($Action) {
        'config' {
            Invoke-Compose -Args @($baseArgs + @('config'))
            break
        }
        'start' {
            $args = @($baseArgs + @('up','-d'))
            if ($Build) { $args += '--build' }
            Invoke-Compose -Args $args
            Write-Host "Started project '$ProjectName' with profiles: $($Profiles -join ', ')" -ForegroundColor Green
            break
        }
        'stop' {
            Invoke-Compose -Args @($baseArgs + @('stop'))
            Write-Host "Stopped project '$ProjectName'" -ForegroundColor Yellow
            break
        }
        'restart' {
            # stop -> up -d (optional build)
            Invoke-Compose -Args @($baseArgs + @('stop'))
            $args = @($baseArgs + @('up','-d'))
            if ($Build) { $args += '--build' }
            Invoke-Compose -Args $args
            Write-Host "Restarted project '$ProjectName'" -ForegroundColor Green
            break
        }
        'status' {
            Invoke-Compose -Args @($baseArgs + @('ps'))
            break
        }
        'logs' {
            Invoke-Compose -Args @($baseArgs + @('logs','-f','--tail=100'))
            break
        }
        'down' {
            Invoke-Compose -Args @($baseArgs + @('down'))
            Write-Host "Brought down project '$ProjectName' (kept volumes)" -ForegroundColor Yellow
            break
        }
        'clean' {
            Invoke-Compose -Args @($baseArgs + @('down','-v','--remove-orphans'))
            Write-Host "Cleaned project '$ProjectName' (containers, network, volumes removed)" -ForegroundColor Yellow
            break
        }
        'rebuild' {
            # Rebuild images (no cache optionality can be added via --no-cache in future)
            Invoke-Compose -Args @($baseArgs + @('build'))
            # Always up -d after build
            Invoke-Compose -Args @($baseArgs + @('up','-d'))
            Write-Host "Rebuilt and started project '$ProjectName'" -ForegroundColor Green
            break
        }
        default { throw "Unknown action: $Action" }
    }
}
finally {
    Pop-Location
}
