import { useState, useEffect } from 'react'
import LandingPage from './components/landing/LandingPage'
import Dashboard from './Dashboard'

export default function AppRouter() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname)

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname)
    }

    // Listen for popstate (browser back/forward)
    window.addEventListener('popstate', handleLocationChange)

    // Override pushState and replaceState
    const originalPushState = window.history.pushState
    const originalReplaceState = window.history.replaceState

    window.history.pushState = function(...args) {
      originalPushState.apply(window.history, args)
      handleLocationChange()
    }

    window.history.replaceState = function(...args) {
      originalReplaceState.apply(window.history, args)
      handleLocationChange()
    }

    return () => {
      window.removeEventListener('popstate', handleLocationChange)
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
    }
  }, [])

  if (currentPath === '/dashboard' || currentPath === '/dashboard/') {
    return <Dashboard />
  }

  return <LandingPage />
}
