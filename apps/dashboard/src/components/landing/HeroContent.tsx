"use client"

import { motion } from "framer-motion"

export default function HeroContent() {
  const scrollToDashboard = () => {
    window.location.href = '/dashboard'
  }

  return (
    <main className="flex items-center justify-start px-8 h-full">
      <motion.div 
        className="text-left max-w-3xl"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.3 }}
      >
        {/* Badge */}
        <motion.div
          className="inline-flex items-center px-4 py-2 rounded-full bg-white/5 backdrop-blur-sm mb-6 relative border border-white/10"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <div className="absolute top-0 left-2 right-2 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent rounded-full" />
          <span className="text-white/90 text-sm font-light relative z-10">✨ Event-Driven Microservices Architecture</span>
        </motion.div>

        {/* Main Heading */}
        <motion.h1 
          className="text-5xl md:text-6xl lg:text-7xl tracking-tight font-light text-white mb-6 leading-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
        >
          <span className="font-semibold bg-gradient-to-r from-violet-300 via-fuchsia-300 to-violet-300 bg-clip-text text-transparent">Real-time</span> Order
          <br />
          <span className="font-light tracking-tight text-white">Management</span>
        </motion.h1>

        {/* Description */}
        <motion.p 
          className="text-base font-light text-white/70 mb-8 leading-relaxed max-w-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          Experience the power of CQRS and Event Sourcing with real-time order tracking, 
          saga orchestration, and beautiful visualizations. Built with Kafka, MongoDB, and React.
        </motion.p>

        {/* Feature Pills */}
        <motion.div 
          className="flex flex-wrap gap-3 mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1 }}
        >
          <div className="px-4 py-2 rounded-full bg-violet-500/20 border border-violet-500/30 backdrop-blur-sm">
            <span className="text-white/90 text-xs font-medium">Kafka Event Streaming</span>
          </div>
          <div className="px-4 py-2 rounded-full bg-fuchsia-500/20 border border-fuchsia-500/30 backdrop-blur-sm">
            <span className="text-white/90 text-xs font-medium">Real-time Updates</span>
          </div>
          <div className="px-4 py-2 rounded-full bg-blue-500/20 border border-blue-500/30 backdrop-blur-sm">
            <span className="text-white/90 text-xs font-medium">Saga Orchestration</span>
          </div>
        </motion.div>

        {/* Buttons */}
        <motion.div 
          className="flex items-center gap-4 flex-wrap"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.2 }}
        >
          <button 
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            className="px-8 py-3 rounded-full bg-transparent border-2 border-white/30 text-white font-medium text-sm transition-all duration-200 hover:bg-white/10 hover:border-white/50 hover:scale-105 cursor-pointer"
          >
            Learn More
          </button>
          <button 
            onClick={scrollToDashboard}
            className="px-8 py-3 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-medium text-sm transition-all duration-200 hover:from-violet-500 hover:to-fuchsia-500 hover:scale-105 cursor-pointer shadow-lg shadow-violet-500/50"
          >
            View Dashboard
          </button>
        </motion.div>
      </motion.div>
    </main>
  )
}
