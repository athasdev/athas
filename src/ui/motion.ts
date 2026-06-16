import type { Transition } from "framer-motion";

type Bezier = [number, number, number, number];

export const motionEase = {
  smooth: [0.22, 1, 0.36, 1],
  out: [0.17, 1, 0.32, 1],
  spring: [0.35, 1.55, 0.65, 1],
  inOut: [0.66, 0, 0.34, 1],
} satisfies Record<string, Bezier>;

export const motionDuration = {
  fast: 0.15,
  normal: 0.2,
  slow: 0.28,
} as const;

export const overlayTransition: Transition = {
  duration: motionDuration.fast,
  ease: motionEase.smooth,
};

export const overlayEntrance = {
  initial: { opacity: 0, scale: 0.98, y: 6, filter: "blur(2px)" },
  animate: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.98, y: 4, filter: "blur(2px)" },
  transition: overlayTransition,
} as const;

export const decorativeEntranceTransition: Transition = {
  duration: motionDuration.slow,
  ease: motionEase.out,
};

export const instantTransition: Transition = {
  duration: 0,
};
