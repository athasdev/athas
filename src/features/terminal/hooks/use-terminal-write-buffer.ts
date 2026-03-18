import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";

const WRITE_FLUSH_MS = 8;
const MAX_BATCH_SIZE = 4096;

export function useTerminalWriteBuffer(getConnectionId: () => string | null) {
  const queueRef = useRef("");
  const timerRef = useRef<number | null>(null);
  const flushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;

    const connectionId = getConnectionId();
    const data = queueRef.current;
    if (!connectionId || !data) return;

    queueRef.current = "";
    flushingRef.current = true;
    try {
      await invoke("terminal_write", { id: connectionId, data });
    } catch {
      queueRef.current = data + queueRef.current;
    } finally {
      flushingRef.current = false;
      if (queueRef.current) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          void flush();
        }, WRITE_FLUSH_MS);
      }
    }
  }, [getConnectionId]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, WRITE_FLUSH_MS);
  }, [flush]);

  const write = useCallback(
    (data: string) => {
      if (!data) return;

      queueRef.current += data;
      if (queueRef.current.length >= MAX_BATCH_SIZE) {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        void flush();
        return;
      }

      scheduleFlush();
    },
    [flush, scheduleFlush],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      void flush();
    };
  }, [flush]);

  return { write, flush };
}
