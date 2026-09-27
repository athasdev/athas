/**
 * Drains a queue the native side keeps, such as deep links or CLI open requests. Taking empties
 * the native queue, so every item taken is handled, even when the component that asked for the
 * drain has unmounted by then (StrictMode mounts effects twice, and the first drain can finish
 * after its unmount). Drains never overlap: a drain requested while one runs takes the queue
 * once more after it, so nothing queued in between waits for the next signal.
 */
export function createPendingQueueDrain<T>(options: {
  take: () => Promise<T[]>;
  handle: (item: T) => void;
  onError: (error: unknown) => void;
}): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;

  const run = async () => {
    do {
      again = false;
      try {
        for (const item of await options.take()) options.handle(item);
      } catch (error) {
        options.onError(error);
      }
    } while (again);
  };

  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = run().finally(() => {
      running = null;
    });
    return running;
  };
}
