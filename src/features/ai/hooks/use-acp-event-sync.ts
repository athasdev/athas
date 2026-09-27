import { useEffect } from "react";
import { startAcpEventSync } from "@/features/ai/services/acp-event-sync";

/** Keeps this window's agent state in step with ACP events while the window is open. */
export function useAcpEventSync() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    startAcpEventSync()
      .then((unlisten) => {
        // The window may already be gone by the time the listener is registered.
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch((error) => {
        if (!disposed) console.error("Failed to listen for ACP events:", error);
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
}
