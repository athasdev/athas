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
  /**
   * Hands every queued byte to the terminal at once and stops waiting for write callbacks. A
   * disposed xterm never calls them back, so anything waiting on `whenDrained` would otherwise
   * hang and keep the connection it was going to close.
   */
  dispose: () => void;
  isDisposed: () => boolean;
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
  // Consumed chunks are skipped by index instead of shifted off, so a burst of many small chunks
  // drains in linear time.
  let headIndex = 0;
  let firstChunkOffset = 0;
  let queuedByteCount = 0;
  let writeInProgress = false;
  let flushScheduled = false;
  let disposed = false;

  const hasQueuedChunks = () => headIndex < chunks.length;
  const notifyQueuedBytes = () => onQueuedBytesChange?.(queuedByteCount);
  const resolveDrained = () => {
    if (!disposed && (queuedByteCount !== 0 || writeInProgress || hasQueuedChunks())) return;
    for (const resolve of drainedResolvers) resolve();
    drainedResolvers.clear();
  };

  const compactChunks = () => {
    if (headIndex === chunks.length) {
      chunks.length = 0;
      headIndex = 0;
    } else if (headIndex >= 1024 && headIndex * 2 >= chunks.length) {
      chunks.splice(0, headIndex);
      headIndex = 0;
    }
  };

  const takeBatch = (limit: number): Uint8Array => {
    let size = 0;
    for (let index = headIndex; index < chunks.length && size < limit; index += 1) {
      size += chunks[index].byteLength - (index === headIndex ? firstChunkOffset : 0);
    }
    size = Math.min(size, limit);

    const batch = new Uint8Array(size);
    let written = 0;
    while (written < size && hasQueuedChunks()) {
      const chunk = chunks[headIndex];
      const length = Math.min(chunk.byteLength - firstChunkOffset, size - written);
      batch.set(chunk.subarray(firstChunkOffset, firstChunkOffset + length), written);
      written += length;
      firstChunkOffset += length;
      if (firstChunkOffset === chunk.byteLength) {
        headIndex += 1;
        firstChunkOffset = 0;
      }
    }
    compactChunks();
    return batch;
  };

  const drain = () => {
    flushScheduled = false;
    if (disposed || writeInProgress || !hasQueuedChunks()) {
      resolveDrained();
      return;
    }
    const batch = takeBatch(maxBatchBytes);
    writeInProgress = true;
    let completed = false;
    const complete = () => {
      if (completed || disposed) return;
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
    if (disposed || flushScheduled || writeInProgress) return;
    flushScheduled = true;
    schedule(drain);
  };

  return {
    enqueue: (data) => {
      if (disposed || data.byteLength === 0) return;
      chunks.push(data);
      queuedByteCount += data.byteLength;
      notifyQueuedBytes();
      scheduleFlush();
    },
    flush: drain,
    queuedBytes: () => queuedByteCount,
    whenDrained: () => {
      if (disposed || (queuedByteCount === 0 && !writeInProgress && !hasQueuedChunks())) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => drainedResolvers.add(resolve));
    },
    dispose: () => {
      if (disposed) return;
      const remaining = hasQueuedChunks() ? takeBatch(Number.POSITIVE_INFINITY) : null;
      disposed = true;
      chunks.length = 0;
      headIndex = 0;
      firstChunkOffset = 0;
      writeInProgress = false;
      if (remaining && remaining.byteLength > 0) {
        try {
          write(remaining, () => {});
        } catch (error) {
          onWriteError?.(error);
        }
      }
      queuedByteCount = 0;
      notifyQueuedBytes();
      resolveDrained();
    },
    isDisposed: () => disposed,
  };
}
