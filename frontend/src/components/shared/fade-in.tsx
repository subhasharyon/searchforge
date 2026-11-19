"use client"

import { motion, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"

import { transitions } from "@/lib/motion"

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const reduce = useReducedMotion()

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transitions.slow, delay }}
    >
      {children}
    </motion.div>
  )
}
