const DEFAULT_MAX_BATCH_BYTES = 64 * 1024;

interface TerminalOutputBufferOptions {
  maxBatchBytes?: number;
  onQueuedBytesChange?: (queuedBytes: number) => void;
  onWriteError?: (error: unknown) => void;
  schedule?: (callback: () => void) => void;
  write: (data: Uint8Array, callback: () => void) => void;
}

export interface TerminalOutputBuffer {
  enqueue: (data: Uint8Array) => void;
  flush: () => void;
  queuedBytes: () => number;
  whenDrained: () => Promise<void>;
}

export function createTerminalOutputBuffer({
  maxBatchBytes = DEFAULT_MAX_BATCH_BYTES,
  onQueuedBytesChange,
  onWriteError,
  schedule = queueMicrotask,
  write,
}: TerminalOutputBufferOptions): TerminalOutputBuffer {
  const chunks: Uint8Array[] = [];
  const drainedResolvers = new Set<() => void>();
  let firstChunkOffset = 0;
  let queuedByteCount = 0;
  let writeInProgress = false;
  let flushScheduled = false;

  const notifyQueuedBytes = () => onQueuedBytesChange?.(queuedByteCount);
  const resolveDrained = () => {
    if (queuedByteCount !== 0 || writeInProgress || chunks.length !== 0) return;
    for (const resolve of drainedResolvers) resolve();
    drainedResolvers.clear();
  };

  const takeBatch = (): Uint8Array => {
    const size = Math.min(
      maxBatchBytes,
      chunks.reduce((total, chunk, index) => {
        const available = chunk.byteLength - (index === 0 ? firstChunkOffset : 0);
        return Math.min(maxBatchBytes, total + available);
      }, 0),
    );
    const batch = new Uint8Array(size);
    let written = 0;
    while (written < size) {
      const chunk = chunks[0];
      if (!chunk) break;
      const available = chunk.byteLength - firstChunkOffset;
      const length = Math.min(available, size - written);
      batch.set(chunk.subarray(firstChunkOffset, firstChunkOffset + length), written);
      written += length;
      firstChunkOffset += length;
      if (firstChunkOffset === chunk.byteLength) {
        chunks.shift();
        firstChunkOffset = 0;
      }
    }
    return batch;
  };

  const drain = () => {
    flushScheduled = false;
    if (writeInProgress || chunks.length === 0) {
      resolveDrained();
      return;
    }
    const batch = takeBatch();
    writeInProgress = true;
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      writeInProgress = false;
      queuedByteCount = Math.max(0, queuedByteCount - batch.byteLength);
      notifyQueuedBytes();
      drain();
    };
    try {
      write(batch, complete);
    } catch (error) {
      onWriteError?.(error);
      complete();
    }
  };

  const scheduleFlush = () => {
    if (flushScheduled || writeInProgress) return;
    flushScheduled = true;
    schedule(drain);
  };

  return {
    enqueue: (data) => {
      if (data.byteLength === 0) return;
      chunks.push(data);
      queuedByteCount += data.byteLength;
      notifyQueuedBytes();
      scheduleFlush();
    },
    flush: drain,
    queuedBytes: () => queuedByteCount,
    whenDrained: () => {
      if (queuedByteCount === 0 && !writeInProgress && chunks.length === 0) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => drainedResolvers.add(resolve));
    },
  };
}
