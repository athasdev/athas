import { type ComponentType, useEffect, useRef, useState } from "react";

interface DeferredEventDialogProps {
  /** The window event the dialog opens on. */
  event: string;
  /** Loads the dialog component; called once, the first time the event fires. */
  load: () => Promise<ComponentType>;
}

/**
 * Keeps a dialog that opens through a window event out of startup: its code loads when the event
 * first fires. That first event is replayed once the dialog has mounted and listens for it itself,
 * so the first open behaves like every later one.
 */
export function DeferredEventDialog({ event, load }: DeferredEventDialogProps) {
  const [Dialog, setDialog] = useState<ComponentType | null>(null);
  const pendingEventRef = useRef<Event | null>(null);

  useEffect(() => {
    if (Dialog) return;
    let cancelled = false;
    const handleEvent = (pendingEvent: Event) => {
      const isFirst = pendingEventRef.current === null;
      pendingEventRef.current = pendingEvent;
      if (!isFirst) return;
      void load().then((component) => {
        if (!cancelled) setDialog(() => component);
      });
    };
    window.addEventListener(event, handleEvent);
    return () => {
      cancelled = true;
      window.removeEventListener(event, handleEvent);
    };
  }, [Dialog, event, load]);

  // Runs after the dialog's own effects, so its listener is in place for the replay.
  useEffect(() => {
    const pendingEvent = pendingEventRef.current;
    if (!Dialog || !pendingEvent) return;
    pendingEventRef.current = null;
    window.dispatchEvent(
      new CustomEvent(pendingEvent.type, {
        detail: pendingEvent instanceof CustomEvent ? pendingEvent.detail : undefined,
      }),
    );
  }, [Dialog]);

  return Dialog ? <Dialog /> : null;
}
