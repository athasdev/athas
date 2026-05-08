import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { useTerminalSlotsStore } from "../stores/terminal-slots-store";
import { useTerminalStore } from "../stores/terminal-store";
import { XtermTerminal } from "./terminal";

// Renders all live xterm instances at app root. Each session owns a stable
// wrapper <div> that's reparented (via raw appendChild) into whichever slot
// is currently displaying it. React always portals XtermTerminal into the
// wrapper — only the wrapper's DOM parent changes. Pane moves never unmount
// xterm; PTY listeners + scrollback survive.
export function TerminalHost() {
  const slotIds = useTerminalSlotsStore(useShallow((state) => Array.from(state.slots.keys())));
  const sessionStoreIds = useTerminalStore(
    useShallow((state) => Array.from(state.sessions.keys())),
  );

  const knownRef = useRef<{ all: Set<string>; everInStore: Set<string> }>({
    all: new Set(),
    everInStore: new Set(),
  });

  for (const id of slotIds) knownRef.current.all.add(id);
  for (const id of sessionStoreIds) {
    knownRef.current.all.add(id);
    knownRef.current.everInStore.add(id);
  }

  // Once a session has been registered in the terminal store (PTY connected),
  // its disappearance from there means it was explicitly closed — drop it.
  for (const id of Array.from(knownRef.current.all)) {
    if (knownRef.current.everInStore.has(id) && !sessionStoreIds.includes(id)) {
      knownRef.current.all.delete(id);
      knownRef.current.everInStore.delete(id);
    }
  }

  const liveIds = useMemo(
    () => Array.from(knownRef.current.all),
    // Recompute whenever either source changes.
    [slotIds, sessionStoreIds],
  );

  return (
    <>
      {liveIds.map((sessionId) => (
        <XtermPortal key={sessionId} sessionId={sessionId} />
      ))}
    </>
  );
}

function XtermPortal({ sessionId }: { sessionId: string }) {
  const slotEl = useTerminalSlotsStore((state) => state.slots.get(sessionId)?.el);
  const slot = useTerminalSlotsStore((state) => state.slots.get(sessionId));

  // Stable wrapper that hosts the xterm DOM for the lifetime of this session.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  if (!wrapperRef.current && typeof document !== "undefined") {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.height = "100%";
    wrapper.style.width = "100%";
    wrapper.style.minHeight = "0";
    wrapper.setAttribute("data-terminal-wrapper", sessionId);
    wrapperRef.current = wrapper;
  }

  // Reparent the wrapper into the active slot whenever the slot changes.
  // When no slot exists, park it offscreen so xterm stays mounted + sized.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    if (slotEl) {
      // Append to slot — moves DOM if currently elsewhere.
      slotEl.appendChild(wrapper);
    } else {
      // No slot: park offscreen so xterm stays alive without being visible.
      let park = document.querySelector<HTMLDivElement>("[data-terminal-park]");
      if (!park) {
        park = document.createElement("div");
        park.setAttribute("data-terminal-park", "");
        park.style.position = "fixed";
        park.style.left = "-9999px";
        park.style.top = "0";
        park.style.width = "800px";
        park.style.height = "600px";
        park.style.pointerEvents = "none";
        park.style.opacity = "0";
        document.body.appendChild(park);
      }
      park.appendChild(wrapper);
    }
  }, [slotEl]);

  // Tear down wrapper on session end.
  useEffect(() => {
    return () => {
      const wrapper = wrapperRef.current;
      if (wrapper?.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
      wrapperRef.current = null;
    };
  }, []);

  // After slot swap, kick xterm to refit + repaint — TUIs (CC etc.) need
  // a SIGWINCH-like nudge to redraw at the new column count.
  useEffect(() => {
    if (!slotEl) return;
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("athas-terminal-refit", { detail: { sessionId } }));
    });
    return () => cancelAnimationFrame(id);
  }, [slotEl, sessionId]);

  if (!wrapperRef.current) return null;

  return createPortal(
    <XtermTerminal
      sessionId={sessionId}
      isActive={slot?.isActive ?? false}
      isVisible={slot?.isVisible ?? true}
      initialCommand={slot?.initialCommand}
      workingDirectory={slot?.workingDirectory}
      remoteConnectionId={slot?.remoteConnectionId}
      onTerminalExit={slot?.onTerminalExit}
      onTerminalRef={slot?.onTerminalRef}
      onReady={slot?.onReady}
    />,
    wrapperRef.current,
  );
}
