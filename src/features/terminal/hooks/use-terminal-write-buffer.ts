import { useCallback, useEffect, useRef } from "react";

interface TerminalWriteBufferOptions {
  getConnectionId: () => string | null;
  writeChunk: (connectionId: string, data: string) => Promise<void>;
}

export function useTerminalWriteBuffer({
  getConnectionId,
  writeChunk,
}: TerminalWriteBufferOptions) {
  const queueRef = useRef("");
  const flushingRef = useRef(false);
  const getConnectionIdRef = useRef(getConnectionId);
  const writeChunkRef = useRef(writeChunk);

  getConnectionIdRef.current = getConnectionId;
  writeChunkRef.current = writeChunk;

  const flush = useCallback(async () => {
    if (flushingRef.current) return;

    while (queueRef.current) {
      const connectionId = getConnectionIdRef.current();
      const data = queueRef.current;
      if (!connectionId) return;

      queueRef.current = "";
      flushingRef.current = true;
      try {
        await writeChunkRef.current(connectionId, data);
      } catch {
        queueRef.current = data + queueRef.current;
        break;
      } finally {
        flushingRef.current = false;
      }
    }
  }, []);

  const write = useCallback(
    (data: string) => {
      if (!data) return;
      queueRef.current += data;
      void flush();
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  return { write, flush };
}
