import { create } from "zustand";
import type { GitBlameLine } from "@/version-control/git/models/git-types";

interface GitBlameHoverState {
  // State
  isVisible: boolean;
  position: { x: number; y: number } | null;
  blameLine: GitBlameLine | null;
  isHovering: boolean;

  // Actions
  actions: {
    showHover: (blameLine: GitBlameLine, position: { x: number; y: number }) => void;
    hideHover: () => void;
    updatePosition: (position: { x: number; y: number }) => void;
    setIsHovering: (isHovering: boolean) => void;
  };
}

export const useGitBlameHoverStore = create<GitBlameHoverState>((set, get) => ({
  // Initial state
  isVisible: false,
  position: null,
  blameLine: null,
  isHovering: false,

  // Actions
  actions: {
    showHover: (blameLine: GitBlameLine, position: { x: number; y: number }) => {
      set({
        isVisible: true,
        blameLine,
        position,
        isHovering: false,
      });
    },

    hideHover: () => {
      const state = get();
      // Only hide if not actively hovering over the card
      if (!state.isHovering) {
        set({
          isVisible: false,
          blameLine: null,
          position: null,
        });
      }
    },

    updatePosition: (position: { x: number; y: number }) => {
      set({ position });
    },

    setIsHovering: (isHovering: boolean) => {
      set({ isHovering });

      // If we stop hovering and the card is visible, hide it after a small delay
      if (!isHovering && get().isVisible) {
        setTimeout(() => {
          const currentState = get();
          if (!currentState.isHovering) {
            set({
              isVisible: false,
              blameLine: null,
              position: null,
            });
          }
        }, 100);
      }
    },
  },
}));
