import { type ComponentType, useEffect, useRef, useState } from "react";
import { type AppEventMap, type AppEventName, emitAppEvent, onAppEvent } from "@/utils/app-events";

interface DeferredEventDialogProps {
  /** The app event the dialog opens on. */
  event: AppEventName;
  /** Loads the dialog component; called once, the first time the event fires. */
  load: () => Promise<ComponentType>;
}

/**
 * Keeps a dialog that opens through an app event out of startup: its code loads when the event
 * first fires. That first event is replayed once the dialog has mounted and listens for it itself,
 * so the first open behaves like every later one.
 */
export function DeferredEventDialog({ event, load }: DeferredEventDialogProps) {
  const [Dialog, setDialog] = useState<ComponentType | null>(null);
  const pendingEventRef = useRef<{ payload: AppEventMap[AppEventName] } | null>(null);

  useEffect(() => {
    if (Dialog) return;
    let cancelled = false;
    const unsubscribe = onAppEvent(event, (payload) => {
      const isFirst = pendingEventRef.current === null;
      pendingEventRef.current = { payload };
      if (!isFirst) return;
      void load().then((component) => {
        if (!cancelled) setDialog(() => component);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [Dialog, event, load]);

  // Runs after the dialog's own effects, so its listener is in place for the replay.
  useEffect(() => {
    const pendingEvent = pendingEventRef.current;
    if (!Dialog || !pendingEvent) return;
    pendingEventRef.current = null;
    (emitAppEvent as (name: AppEventName, payload: unknown) => void)(event, pendingEvent.payload);
  }, [Dialog, event]);

  return Dialog ? <Dialog /> : null;
}
