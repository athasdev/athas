import { create } from "zustand";

/**
 * Overlay types in priority order (highest to lowest)
 * Higher priority overlays can hide lower priority ones
 */
export type OverlayType =
  | "context-menu"
  | "inline-toolbar"
  | "completion"
  | "hover-tooltip"
  | "git-blame";

interface OverlayState {
  // Currently visible overlays
  visibleOverlays: Set<OverlayType>;

  // Show an overlay (may hide lower priority overlays)
  showOverlay: (type: OverlayType) => void;

  // Hide an overlay
  hideOverlay: (type: OverlayType) => void;

  // Check if an overlay should be visible
  shouldShowOverlay: (type: OverlayType) => boolean;

  // Hide all overlays
  hideAll: () => void;

  // Hide all overlays except the given type
  hideAllExcept: (type: OverlayType) => void;
}

/**
 * Priority map: higher numbers = higher priority
 */
const OVERLAY_PRIORITY: Record<OverlayType, number> = {
  "context-menu": 5,
  "inline-toolbar": 4,
  completion: 3,
  "hover-tooltip": 2,
  "git-blame": 1,
};

/**
 * Mutual exclusivity rules:
 * When a higher priority overlay is shown, hide lower priority ones
 */
const MUTUALLY_EXCLUSIVE_GROUPS: OverlayType[][] = [
  // Context menu hides everything
  ["context-menu"],
  // Inline toolbar hides completion and git blame
  ["inline-toolbar", "completion", "git-blame"],
  // Completion hides git blame
  ["completion", "git-blame"],
];

/**
 * Check if two overlays are mutually exclusive
 */
const areMutuallyExclusive = (type1: OverlayType, type2: OverlayType): boolean => {
  // If same type, they're not mutually exclusive (same overlay)
  if (type1 === type2) return false;

  // Check if they're in the same mutual exclusion group
  for (const group of MUTUALLY_EXCLUSIVE_GROUPS) {
    if (group.includes(type1) && group.includes(type2)) {
      // Only mutually exclusive if type1 has higher priority
      return OVERLAY_PRIORITY[type1] > OVERLAY_PRIORITY[type2];
    }
  }

  return false;
};

/**
 * Global overlay manager store
 */
export const useOverlayManager = create<OverlayState>((set, get) => ({
  visibleOverlays: new Set(),

  showOverlay: (type: OverlayType) => {
    const { visibleOverlays } = get();
    const newVisibleOverlays = new Set(visibleOverlays);

    // Add the new overlay
    newVisibleOverlays.add(type);

    // Hide mutually exclusive lower-priority overlays
    for (const existingType of visibleOverlays) {
      if (areMutuallyExclusive(type, existingType)) {
        newVisibleOverlays.delete(existingType);
      }
    }

    set({ visibleOverlays: newVisibleOverlays });
  },

  hideOverlay: (type: OverlayType) => {
    const { visibleOverlays } = get();
    const newVisibleOverlays = new Set(visibleOverlays);
    newVisibleOverlays.delete(type);
    set({ visibleOverlays: newVisibleOverlays });
  },

  shouldShowOverlay: (type: OverlayType) => {
    const { visibleOverlays } = get();

    // Check if this overlay is explicitly visible
    if (!visibleOverlays.has(type)) {
      return false;
    }

    // Check if any higher-priority mutually exclusive overlay is visible
    for (const visibleType of visibleOverlays) {
      if (
        visibleType !== type &&
        areMutuallyExclusive(visibleType, type) &&
        OVERLAY_PRIORITY[visibleType] > OVERLAY_PRIORITY[type]
      ) {
        return false;
      }
    }

    return true;
  },

  hideAll: () => {
    set({ visibleOverlays: new Set() });
  },

  hideAllExcept: (type: OverlayType) => {
    set({ visibleOverlays: new Set([type]) });
  },
}));
