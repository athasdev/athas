import type { Transition } from "motion/react";

export const quickTransition: Transition = {
  duration: 0.15,
  ease: [0.22, 1, 0.36, 1],
};

export const instantTransition: Transition = {
  duration: 0,
};
