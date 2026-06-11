import type { Terminal as XtermInstance } from "@xterm/xterm";
import { create } from "zustand";

export interface TerminalSlotProps {
  el: HTMLDivElement;
  isActive: boolean;
  isVisible: boolean;
  initialCommand?: string;
  workingDirectory?: string;
  remoteConnectionId?: string;
  onTerminalExit?: (sessionId: string) => void;
  onTerminalRef?: (ref: {
    focus: () => void;
    showSearch: () => void;
    terminal: XtermInstance;
  }) => void;
  onReady?: () => void;
  // Fired when the user mouses down inside the terminal — owners use this to
  // mark their pane / tab active (portal breaks React event bubbling).
  onActivate?: () => void;
}

interface TerminalSlotsStore {
  slots: Map<string, TerminalSlotProps>;
  register: (sessionId: string, slot: TerminalSlotProps) => void;
  unregister: (sessionId: string, el: HTMLDivElement) => void;
  update: (sessionId: string, partial: Partial<Omit<TerminalSlotProps, "el">>) => void;
}

export const useTerminalSlotsStore = create<TerminalSlotsStore>()((set) => ({
  slots: new Map(),

  register: (sessionId, slot) =>
    set((state) => {
      const next = new Map(state.slots);
      next.set(sessionId, slot);
      return { slots: next };
    }),

  unregister: (sessionId, el) =>
    set((state) => {
      const existing = state.slots.get(sessionId);
      // Only unregister if the element matches — avoids races where a new
      // mount registered before the old unmount cleanup ran.
      if (!existing || existing.el !== el) return state;
      const next = new Map(state.slots);
      next.delete(sessionId);
      return { slots: next };
    }),

  update: (sessionId, partial) =>
    set((state) => {
      const existing = state.slots.get(sessionId);
      if (!existing) return state;
      const next = new Map(state.slots);
      next.set(sessionId, { ...existing, ...partial });
      return { slots: next };
    }),
}));
