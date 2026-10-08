import { TerminalErrorBoundary } from "./terminal-error-boundary";
import { WorkspaceStoreScopeContext } from "@/features/workspace/stores/create-workspace-scoped-store";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { useTerminalSlotsStore } from "../stores/terminal-slots.store";
import { type TerminalStore, useTerminalStore } from "../stores/terminal.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { emitAppEvent } from "@/utils/app-events";
import { TerminalEmulator } from "./terminal";

// Renders all live terminal frontends at app root. Each session owns a stable
// wrapper <div> that's reparented (via raw appendChild) into whichever slot
// is currently displaying it. React always portals TerminalEmulator into the
// wrapper — only the wrapper's DOM parent changes. Pane moves never unmount
// the frontend; PTY listeners + scrollback survive.
export function TerminalHost() {
  const [, refreshWorkspaceSessions] = useReducer((version) => version + 1, 0);
  const slotIds = useTerminalSlotsStore(useShallow((state) => Array.from(state.slots.keys())));
  const activeSessionStoreIds = useTerminalStore(
    useShallow((state) => Array.from(state.sessions.keys())),
  );
  const sessions = workspaceRuntimeRegistry
    .getExistingStores<TerminalStore>("terminal")
    .flatMap((store) =>
      [...store.getState().sessions.keys()].map((sessionId) => ({
        sessionId,
        workspaceId: store.getState().workspaceId,
      })),
    );

  useEffect(
    () => workspaceRuntimeRegistry.subscribeToStoreKey("terminal", refreshWorkspaceSessions),
    [activeSessionStoreIds, slotIds],
  );

  return (
    <>
      {sessions.map(({ sessionId, workspaceId }) => (
        <WorkspaceStoreScopeContext.Provider
          key={`${workspaceId}/${sessionId}`}
          value={workspaceId}
        >
          <TerminalPortal sessionId={sessionId} workspaceId={workspaceId} />
        </WorkspaceStoreScopeContext.Provider>
      ))}
    </>
  );
}

function TerminalPortal({ sessionId, workspaceId }: { sessionId: string; workspaceId: string }) {
  const slot = useTerminalSlotsStore((state) => {
    const slot = state.slots.get(sessionId);
    return slot?.workspaceId === workspaceId ? slot : undefined;
  });
  const slotEl = slot?.el;
  const lastSlotRef = useRef(slot);
  if (slot) lastSlotRef.current = slot;
  const metadata = slot ?? lastSlotRef.current;

  // Stable wrapper that hosts the terminal DOM for the lifetime of this session.
  const [wrapper] = useState(() => {
    if (typeof document === "undefined") return null;
    const wrapper = document.createElement("div");
    wrapper.style.flexDirection = "column";
    wrapper.style.height = "100%";
    wrapper.style.width = "100%";
    wrapper.style.minHeight = "0";
    wrapper.style.minWidth = "0";
    wrapper.setAttribute("data-terminal-wrapper", sessionId);
    return wrapper;
  });

  // Reparent the wrapper into the active slot whenever the slot changes, before the slot paints.
  useLayoutEffect(() => {
    if (!wrapper) return;

    if (slotEl) {
      wrapper.style.display = slot?.isVisible ? "flex" : "none";
      slotEl.appendChild(wrapper);
    } else {
      let park = document.querySelector<HTMLDivElement>("[data-terminal-park]");
      if (!park) {
        park = document.createElement("div");
        park.setAttribute("data-terminal-park", "");
        park.style.display = "none";
        document.body.appendChild(park);
      }
      wrapper.style.display = "none";
      park.appendChild(wrapper);
    }
  }, [slot?.isVisible, slotEl, wrapper]);

  // Tear down wrapper on session end.
  useEffect(() => {
    return () => {
      if (wrapper?.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
    };
  }, [wrapper]);

  // After slot swap, kick the frontend to refit + repaint — TUIs (CC etc.) need
  // a SIGWINCH-like nudge to redraw at the new column count.
  useEffect(() => {
    if (!slotEl) return;
    const id = requestAnimationFrame(() => {
      emitAppEvent("terminal:refit", { sessionId });
    });
    return () => cancelAnimationFrame(id);
  }, [slotEl, sessionId]);

  if (!wrapper) return null;

  return createPortal(
    <TerminalErrorBoundary>
      <TerminalEmulator
        sessionId={sessionId}
        isActive={slot?.isActive ?? false}
        isVisible={slot?.isVisible ?? false}
        shell={metadata?.shell}
        initialCommand={metadata?.initialCommand}
        environment={metadata?.environment}
        workingDirectory={metadata?.workingDirectory}
        remoteConnectionId={metadata?.remoteConnectionId}
        onTerminalExit={metadata?.onTerminalExit}
        onTerminalRef={slot?.onTerminalRef}
        onReady={slot?.onReady}
      />
    </TerminalErrorBoundary>,
    wrapper,
  );
}
