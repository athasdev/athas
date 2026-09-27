import { create } from "zustand";
import { appendAcpTerminalOutput } from "@/features/ai/lib/acp-terminal-output";
import type { AcpTerminalExit, AcpTerminalSnapshot } from "@/features/ai/types/acp.types";
import { createSelectors } from "@/utils/zustand-selectors";

export interface AcpTerminalView extends AcpTerminalSnapshot {
  sessionId: string;
  cwd: string | null;
  /** The agent runs the command itself and only streams its output; Athas has no terminal. */
  displayOnly: boolean;
}

interface AcpTerminalsState {
  terminals: Record<string, AcpTerminalView>;
  actions: {
    start: (
      terminalId: string,
      terminal: Pick<AcpTerminalView, "sessionId" | "cwd" | "displayOnly">,
    ) => void;
    append: (terminalId: string, sessionId: string, data: string) => void;
    /** Records how the command ended; the first exit wins. Returns the terminal's final state. */
    exit: (terminalId: string, sessionId: string, exit: AcpTerminalExit) => AcpTerminalView;
  };
}

const emptyTerminal = (sessionId: string): AcpTerminalView => ({
  sessionId,
  cwd: null,
  displayOnly: false,
  output: "",
  truncated: false,
  exit: null,
});

/**
 * The live output of the terminals agent tool calls show, by terminal id, as the agent's
 * terminals report it. Tool call rows read it while a command runs; the final state is also
 * kept on the tool call so it outlives this store.
 */
const useAcpTerminalsStoreBase = create<AcpTerminalsState>()((set, get) => ({
  terminals: {},
  actions: {
    start: (terminalId, terminal) =>
      set((state) => ({
        terminals: {
          ...state.terminals,
          [terminalId]: {
            ...(state.terminals[terminalId] ?? emptyTerminal(terminal.sessionId)),
            ...terminal,
          },
        },
      })),
    append: (terminalId, sessionId, data) =>
      set((state) => ({
        terminals: {
          ...state.terminals,
          [terminalId]: appendAcpTerminalOutput(
            state.terminals[terminalId] ?? emptyTerminal(sessionId),
            data,
          ),
        },
      })),
    exit: (terminalId, sessionId, exit) => {
      const current = get().terminals[terminalId] ?? emptyTerminal(sessionId);
      const next = current.exit ? current : { ...current, exit };
      if (next !== current || !get().terminals[terminalId]) {
        set((state) => ({ terminals: { ...state.terminals, [terminalId]: next } }));
      }
      return next;
    },
  },
}));

export const useAcpTerminalsStore = createSelectors(useAcpTerminalsStoreBase);
