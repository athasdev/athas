import { create } from "zustand";
import { describeAcpTerminalAuthFailure, runAcpTerminalAuth } from "../lib/acp-terminal-auth";
import { AcpStreamHandler } from "../services/acp-stream-handler";
import type { AcpAuthMethod } from "../types/acp.types";
import { createSelectors } from "@/utils/zustand-selectors";

/**
 * `choosing` waits for the user to pick a method, `signing_in` waits on the agent (or on its
 * restart after a terminal sign-in), and `terminal` waits for the user to finish in a terminal.
 */
type AcpAuthPhase = "choosing" | "signing_in" | "terminal";

export interface AcpAuthRequest {
  agentId: string;
  /** Set when a prompt needed sign-in; startup failures carry none. */
  sessionId: string | null;
  /** The chat that needed the sign-in, when known; startup sign-ins have no session yet. */
  chatId: string | null;
  methods: AcpAuthMethod[];
  phase: AcpAuthPhase;
  activeMethodId: string | null;
  error: string | null;
}

interface AcpAuthState {
  request: AcpAuthRequest | null;
  actions: {
    /** The agent asked the user to sign in. */
    require: (request: {
      agentId: string;
      sessionId: string | null;
      chatId?: string | null;
      methods: AcpAuthMethod[];
    }) => void;
    /**
     * Signs in with the picked method. Resolves true once the agent is signed in and the work
     * that needed it can be retried; false when it failed (the error is kept) or was cancelled.
     */
    choose: (
      methodId: string,
      context: { chatId?: string | null; workingDirectory?: string },
    ) => Promise<boolean>;
    /** Stops waiting on a terminal sign-in and lets the user pick again. */
    cancel: () => void;
    clear: () => void;
  };
}

let terminalWait: AbortController | null = null;

function stopTerminalWait() {
  terminalWait?.abort();
  terminalWait = null;
}

const useAcpAuthStoreBase = create<AcpAuthState>()((set, get) => {
  const isCurrent = (agentId: string, methodId: string) => {
    const request = get().request;
    return request?.agentId === agentId && request.activeMethodId === methodId;
  };
  const update = (changes: Partial<AcpAuthRequest>) =>
    set((state) => (state.request ? { request: { ...state.request, ...changes } } : state));

  return {
    request: null,
    actions: {
      require: ({ agentId, sessionId, chatId = null, methods }) => {
        stopTerminalWait();
        set({
          request: {
            agentId,
            sessionId,
            chatId,
            methods,
            phase: "choosing",
            activeMethodId: null,
            error: null,
          },
        });
      },
      choose: async (methodId, { chatId, workingDirectory }) => {
        const request = get().request;
        const method = request?.methods.find((item) => item.id === methodId);
        if (!request || !method || request.phase !== "choosing") return false;
        const { agentId } = request;

        try {
          if (method.kind === "terminal") {
            if (!method.terminal) throw new Error(`${method.name} has no sign-in command.`);
            stopTerminalWait();
            const wait = new AbortController();
            terminalWait = wait;
            update({ phase: "terminal", activeMethodId: methodId, error: null });
            const exit = await runAcpTerminalAuth(method.terminal, {
              workingDirectory,
              signal: wait.signal,
            });
            if (terminalWait === wait) terminalWait = null;
            if (!exit || !isCurrent(agentId, methodId)) return false;
            if (exit.exitCode !== 0 || exit.signal) {
              throw new Error(describeAcpTerminalAuthFailure(exit));
            }
            update({ phase: "signing_in" });
            // The sign-in happened outside the agent's connection, so the agent starts again.
            await AcpStreamHandler.reconnectAgent(agentId, chatId);
          } else {
            update({ phase: "signing_in", activeMethodId: methodId, error: null });
            await AcpStreamHandler.authenticateAgent(agentId, chatId, methodId);
          }
        } catch (error) {
          if (isCurrent(agentId, methodId)) {
            update({
              phase: "choosing",
              activeMethodId: null,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return false;
        }

        if (!isCurrent(agentId, methodId)) return false;
        set({ request: null });
        return true;
      },
      cancel: () => {
        stopTerminalWait();
        update({ phase: "choosing", activeMethodId: null });
      },
      clear: () => {
        stopTerminalWait();
        set({ request: null });
      },
    },
  };
});

export const useAcpAuthStore = createSelectors(useAcpAuthStoreBase);

/** The sign-in request a chat on `agentId` should show, if any. */
export function selectAgentAuthRequest(
  request: AcpAuthRequest | null,
  agentId: string | null | undefined,
): AcpAuthRequest | null {
  return request && agentId && request.agentId === agentId && request.methods.length > 0
    ? request
    : null;
}
