import type { StoreApi } from "zustand";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import type { TerminalStore } from "../stores/terminal.store";
import type { Terminal } from "../types/terminal.types";
import {
  createTerminalEventChannel,
  type PendingTerminalEventChannel,
} from "../utils/terminal-protocol";
import { closeTerminalConnection } from "./terminal-connection-lifecycle";

interface PendingLaunch {
  signal: AbortSignal;
  promise: Promise<string | null>;
}

const launches = new WeakMap<StoreApi<TerminalStore>, Map<string, PendingLaunch>>();

export function launchTerminalSession({
  owner,
  sessionId,
  updates,
  launch,
}: {
  owner: StoreApi<TerminalStore>;
  sessionId: string;
  updates: Pick<Partial<Terminal>, "currentDirectory" | "remoteConnectionId">;
  launch: (events: PendingTerminalEventChannel, signal: AbortSignal) => Promise<string>;
}): Promise<string | null> {
  const state = owner.getState();
  const sourceSignal = state.actions.getSessionSignal(sessionId);
  const controller = new AbortController();
  const signal = controller.signal;
  const isRegistered = () =>
    workspaceRuntimeRegistry.getWorkspace(state.workspaceId)?.stores.get("terminal") === owner;
  const isCurrent = () =>
    !sourceSignal?.aborted &&
    state.actions.getSessionSignal(sessionId) === sourceSignal &&
    isRegistered();
  if (!sourceSignal || !isCurrent()) return Promise.resolve(null);
  const connected = state.actions.getSession(sessionId)?.connectionId;
  if (connected) return Promise.resolve(connected);

  let pending = launches.get(owner);
  if (!pending) {
    pending = new Map();
    launches.set(owner, pending);
  }
  const existing = pending.get(sessionId);
  if (existing?.signal === sourceSignal) return existing.promise;
  const abort = () => controller.abort();
  sourceSignal.addEventListener("abort", abort, { once: true });
  const unsubscribe = workspaceRuntimeRegistry.subscribe(() => {
    if (!isCurrent()) abort();
  });

  const events = createTerminalEventChannel();
  const entry: PendingLaunch = {
    signal: sourceSignal,
    promise: Promise.resolve().then(async () => {
      try {
        signal.throwIfAborted();
        const connectionId = await launch(events, signal);
        if (!isCurrent()) {
          events.dispose();
          await closeTerminalConnection({
            connectionId,
            remoteConnectionId: updates.remoteConnectionId,
          });
          return null;
        }
        events.bind(connectionId);
        state.actions.updateSession(sessionId, { ...updates, connectionId });
        return connectionId;
      } catch (error) {
        events.dispose();
        if (signal.aborted && error instanceof DOMException && error.name === "AbortError")
          return null;
        throw error;
      } finally {
        sourceSignal.removeEventListener("abort", abort);
        unsubscribe();
        if (pending.get(sessionId)?.signal === sourceSignal) pending.delete(sessionId);
      }
    }),
  };
  pending.set(sessionId, entry);
  return entry.promise;
}
