function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

interface RunAbortableOptions {
  signal: AbortSignal;
  timeout?: number;
  onTimeout?: () => unknown;
}

/**
 * Runs `task` with its own AbortSignal and settles as soon as the parent signal aborts or the
 * timeout elapses, aborting the task instead of waiting for it to notice.
 */
export function runAbortable<T>(
  task: (signal: AbortSignal) => Promise<T>,
  { signal, timeout, onTimeout }: RunAbortableOptions,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const settle = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      signal.removeEventListener("abort", handleParentAbort);
    };

    const handleParentAbort = () => {
      settle();
      controller.abort(abortReason(signal));
      reject(abortReason(signal));
    };

    signal.addEventListener("abort", handleParentAbort, { once: true });

    if (timeout !== undefined) {
      timeoutId = setTimeout(() => {
        settle();
        const error = onTimeout ? onTimeout() : new DOMException("Timed out", "TimeoutError");
        controller.abort(error);
        reject(error);
      }, timeout);
    }

    task(controller.signal).then(
      (value) => {
        settle();
        resolve(value);
      },
      (error: unknown) => {
        settle();
        reject(error);
      },
    );
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(abortReason(signal));
    };
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);

    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

interface RetryWithBackoffOptions {
  /** Total number of attempts, including the first one. */
  attempts: number;
  /** Delay before the first retry; each later retry waits twice as long as the previous one. */
  baseDelay: number;
  signal: AbortSignal;
  onAttemptFailed?: (error: unknown, attempt: number) => void;
}

/** Retries `task` with exponential backoff until it succeeds, attempts run out, or `signal` aborts. */
export async function retryWithBackoff<T>(
  task: () => Promise<T>,
  { attempts, baseDelay, signal, onAttemptFailed }: RetryWithBackoffOptions,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (signal.aborted) throw error;
      onAttemptFailed?.(error, attempt);
      if (attempt >= attempts) throw error;
    }

    await delay(baseDelay * 2 ** (attempt - 1), signal);
  }
}
