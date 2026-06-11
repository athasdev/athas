import { useEffect, useRef } from "react";
import { type TerminalSlotProps, useTerminalSlotsStore } from "../stores/terminal-slots.store";

interface Props extends Omit<TerminalSlotProps, "el"> {
  sessionId: string;
}

// Mounts a stable DOM target for a terminal session. The actual XtermTerminal
// instance is rendered globally by TerminalHost and portaled into this slot.
// Moving the slot between panes only re-targets the portal — xterm state and
// PTY listeners are preserved.
export function TerminalSlot({
  sessionId,
  isActive,
  isVisible,
  initialCommand,
  workingDirectory,
  remoteConnectionId,
  onTerminalExit,
  onTerminalRef,
  onReady,
  onActivate,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { register, unregister } = useTerminalSlotsStore.getState();
    register(sessionId, {
      el,
      isActive,
      isVisible,
      initialCommand,
      workingDirectory,
      remoteConnectionId,
      onTerminalExit,
      onTerminalRef,
      onReady,
      onActivate,
    });
    return () => unregister(sessionId, el);
    // Mount/unmount only — prop updates handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    useTerminalSlotsStore.getState().update(sessionId, {
      isActive,
      isVisible,
      initialCommand,
      workingDirectory,
      remoteConnectionId,
      onTerminalExit,
      onTerminalRef,
      onReady,
      onActivate,
    });
  }, [
    sessionId,
    isActive,
    isVisible,
    initialCommand,
    workingDirectory,
    remoteConnectionId,
    onTerminalExit,
    onTerminalRef,
    onReady,
    onActivate,
  ]);

  // Native DOM listener: portaled xterm clicks don't bubble through the React
  // tree, so a React handler here would never fire. Native bubbling does
  // reach this div.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onActivate?.();
    el.addEventListener("mousedown", handler, true);
    return () => el.removeEventListener("mousedown", handler, true);
  }, [onActivate]);

  return <div ref={ref} data-terminal-slot={sessionId} className="flex size-full flex-col" />;
}
