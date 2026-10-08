import { useUIState } from "@/features/window/stores/ui-state.store";
import type { CommandPaletteViewId } from "../types/view.types";

interface CommandPaletteSession {
  pushView: (view: CommandPaletteViewId) => void;
}

let activeSession: CommandPaletteSession | null = null;

/** Lets commands drive the open palette. Returns the detach function for the mounting effect. */
export function attachCommandPaletteSession(session: CommandPaletteSession): () => void {
  activeSession = session;
  return () => {
    if (activeSession === session) activeSession = null;
  };
}

/**
 * Shows a palette view on top of the current one, so Back returns to the command list. When the
 * palette is closed (the command ran from a keybinding) it opens directly on that view.
 */
export function pushCommandPaletteView(view: CommandPaletteViewId): void {
  if (activeSession) {
    activeSession.pushView(view);
    return;
  }

  useUIState.getState().openCommandPaletteView(view);
}
