import { useCallback, useEffect, useRef } from "react";
import type { TerminalInput } from "../types/terminal.types";

interface TerminalWriteBufferOptions {
  getConnectionId: () => string | null;
  writeChunk: (connectionId: string, input: TerminalInput) => Promise<void>;
}

export function useTerminalWriteBuffer({
  getConnectionId,
  writeChunk,
}: TerminalWriteBufferOptions) {
  const queueRef = useRef<TerminalInput[]>([]);
  const flushPromiseRef = useRef<Promise<void> | null>(null);
  const getConnectionIdRef = useRef(getConnectionId);
  const writeChunkRef = useRef(writeChunk);

  getConnectionIdRef.current = getConnectionId;
  writeChunkRef.current = writeChunk;

  const flush = useCallback((): Promise<void> => {
    if (flushPromiseRef.current) return flushPromiseRef.current;

    let shouldContinue = true;
    const promise = (async () => {
      while (queueRef.current.length > 0) {
        const connectionId = getConnectionIdRef.current();
        if (!connectionId) return;

        const input = queueRef.current.shift();
        if (!input) continue;

        try {
          await writeChunkRef.current(connectionId, input);
        } catch {
          queueRef.current.unshift(input);
          shouldContinue = false;
          break;
        }
      }
    })().finally(() => {
      flushPromiseRef.current = null;
      if (shouldContinue && queueRef.current.length > 0 && getConnectionIdRef.current()) {
        void flush();
      }
    });

    flushPromiseRef.current = promise;
    return promise;
  }, []);

  const write = useCallback(
    (data: string) => {
      if (!data) return;
      const last = queueRef.current[queueRef.current.length - 1];
      if (last?.kind === "text") {
        last.data += data;
      } else {
        queueRef.current.push({ kind: "text", data });
      }
      void flush();
    },
    [flush],
  );

  const writeBinary = useCallback(
    (data: number[]) => {
      if (data.length === 0) return;
      queueRef.current.push({ kind: "binary", data });
      void flush();
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  return { write, writeBinary, flush };
}
