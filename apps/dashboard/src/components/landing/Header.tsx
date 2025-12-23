"use client"

import { motion } from "framer-motion"

export default function Header() {
  const scrollToDashboard = () => {
    window.location.href = '/dashboard'
  }

  return (
    <header className="relative z-20 flex items-center justify-between p-6">
      {/* Logo */}
      <motion.div 
        className="flex items-center gap-3"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        </div>
        <span className="text-white font-semibold text-lg">OrderFlow</span>
      </motion.div>

      {/* Dashboard Button with Arrow Effect */}
      <motion.div 
        className="relative flex items-center group" 
        style={{ filter: "url(#gooey-filter)" }}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
      >
        <button 
          onClick={scrollToDashboard}
          className="absolute right-0 px-3 py-2 rounded-full bg-white text-black font-medium text-sm transition-all duration-300 hover:bg-white/90 cursor-pointer h-10 flex items-center justify-center -translate-x-10 group-hover:-translate-x-24 z-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
        <button 
          onClick={scrollToDashboard}
          className="px-6 py-2 rounded-full bg-white text-black font-medium text-sm transition-all duration-300 hover:bg-white/90 cursor-pointer h-10 flex items-center z-10"
        >
          Open Dashboard
        </button>
      </motion.div>
    </header>
  )
}
