"use client"

import { useEffect, useRef, useState } from "react"
import { MeshGradient } from "@paper-design/shaders-react"

interface ShaderBackgroundProps {
  children: React.ReactNode
}

export default function ShaderBackground({ children }: ShaderBackgroundProps) {
  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* SVG Filters */}
      <svg className="absolute inset-0 w-0 h-0">
        <defs>
          <filter id="gooey-filter" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
              result="gooey"
            />
            <feComposite in="SourceGraphic" in2="gooey" operator="atop" />
          </filter>
        </defs>
      </svg>

      {/* Simplified Background - Single Shader for Performance */}
      <MeshGradient
        className="absolute inset-0 w-full h-full"
        colors={["#000000", "#8b5cf6", "#1e1b4b", "#4c1d95"]}
        speed={0.15}
      />

      {/* Static gradient overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-900/20 via-transparent to-fuchsia-900/20 pointer-events-none" />

      {children}
    </div>
  )
}
