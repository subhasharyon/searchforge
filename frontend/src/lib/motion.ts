import type { Transition } from "motion/react"

/**
 * Shared motion tokens. Keep micro-interactions restrained:
 * prefer `fast`/`base` for hovers and state changes, `slow` for
 * enter/exit, and `spring` for elements that should feel physical.
 */
export const transitions = {
  fast: { duration: 0.15, ease: [0.16, 1, 0.3, 1] },
  base: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  slow: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  spring: { type: "spring", stiffness: 320, damping: 30 },
} satisfies Record<string, Transition>
