"use client"

import { motion } from "framer-motion"
import { PulsingBorder } from "@paper-design/shaders-react"

export default function PulsingCircle() {
  return (
    <motion.div 
      className="absolute bottom-8 right-8 z-30 hidden lg:block"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay: 1.5 }}
    >
      <div className="relative w-24 h-24 flex items-center justify-center">
        {/* Pulsing Border Circle */}
        <PulsingBorder
          colors={["#8b5cf6", "#ec4899", "#06b6d4", "#10b981", "#f59e0b"]}
          colorBack="#00000000"
          speed={1.5}
          roundness={1}
          thickness={0.12}
          softness={0.2}
          intensity={6}
          spotSize={0.1}
          pulse={0.12}
          smoke={0.6}
          smokeSize={4}
          scale={0.7}
          rotation={0}
          frame={Date.now() * 0.001}
          style={{
            width: "70px",
            height: "70px",
            borderRadius: "50%",
          }}
        />

        {/* Rotating Text Around the Pulsing Border */}
        <motion.svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 100"
          animate={{ rotate: 360 }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear",
          }}
          style={{ transform: "scale(1.7)" }}
        >
          <defs>
            <path id="circle-path" d="M 50, 50 m -38, 0 a 38,38 0 1,1 76,0 a 38,38 0 1,1 -76,0" />
          </defs>
          <text className="text-[7px] fill-white/80 font-light tracking-wide">
            <textPath href="#circle-path" startOffset="0%">
              Real-time Events • Saga Pattern • CQRS • Event Sourcing •
            </textPath>
          </text>
        </motion.svg>
      </div>
    </motion.div>
  )
}
