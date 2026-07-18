import type { Transition } from "framer-motion";

export const quickTransition: Transition = {
  duration: 0.15,
  ease: [0.22, 1, 0.36, 1],
};

export const overlayEntrance = {
  initial: { opacity: 0, scale: 0.98, y: 6, filter: "blur(2px)" },
  animate: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.98, y: 4, filter: "blur(2px)" },
  transition: quickTransition,
} as const;

export const instantTransition: Transition = {
  duration: 0,
};
