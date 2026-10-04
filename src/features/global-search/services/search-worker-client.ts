import type {
  SearchTask,
  SearchTaskResult,
  SearchWorkerResponse,
  TaskResult,
} from "../workers/search-worker-protocol";

const MATCH_TIMEOUT_MS = 5_000;
interface PendingTask {
  id: number;
  task: SearchTask;
  resolve: (result: SearchTaskResult) => void;
  reject: (error: Error) => void;
}
export function createSearchWorkerSession({
  signal,
  isCancelled = () => false,
}: { signal?: AbortSignal; isCancelled?: () => boolean } = {}) {
  let worker: Worker | undefined;
  let failure: Error | undefined;
  let nextId = 0;
  let active: PendingTask | undefined;
  const queued: PendingTask[] = [];
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let cancellationPoll: ReturnType<typeof setInterval> | undefined;
  const clearDeadline = () => {
    if (deadline !== undefined) clearTimeout(deadline);
    deadline = undefined;
  };
  const dispose = (error = new Error("The search worker session has ended.")) => {
    failure ??= error;
    clearDeadline();
    if (cancellationPoll !== undefined) clearInterval(cancellationPoll);
    cancellationPoll = undefined;
    signal?.removeEventListener("abort", cancel);
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = undefined;
    }
    active?.reject(failure);
    active = undefined;
    for (const pending of queued.splice(0)) pending.reject(failure);
  };
  const cancel = () => {
    const error = new Error("The search or replacement was cancelled.");
    error.name = "AbortError";
    dispose(error);
  };
  const cancelled = () => {
    if (signal?.aborted || isCancelled()) {
      cancel();
      return true;
    }
    return false;
  };
  const dispatch = () => {
    if (failure || active || cancelled()) return;
    const pending = queued.shift();
    if (!pending) return;
    active = pending;
    try {
      if (!worker) {
        worker = new Worker(new URL("../workers/search-worker.ts", import.meta.url), {
          type: "module",
        });
        worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
          if (!active || event.data.id !== active.id || failure || cancelled()) return;
          const completed = active;
          active = undefined;
          clearDeadline();
          if (event.data.error !== undefined) completed.reject(new Error(event.data.error));
          else completed.resolve(event.data.result);
          dispatch();
        };
        worker.onerror = (event) => {
          event.preventDefault();
          dispose(new Error("The search worker failed. Try the search again."));
        };
        worker.onmessageerror = () =>
          dispose(new Error("The search worker returned an unreadable response."));
        cancellationPoll = setInterval(cancelled, 50);
      }
      deadline = setTimeout(
        () =>
          dispose(
            new Error(
              `Search matching took too long in ${pending.task.filePath}. Simplify the expression or search smaller files.`,
            ),
          ),
        MATCH_TIMEOUT_MS,
      );
      worker.postMessage({ id: pending.id, task: pending.task });
    } catch {
      dispose(new Error("Could not start the search worker. Try the search again."));
    }
  };
  signal?.addEventListener("abort", cancel, { once: true });
  return {
    run<T extends SearchTask>(task: T): Promise<TaskResult<T>> {
      if (cancelled() || failure) return Promise.reject(failure);
      return new Promise<SearchTaskResult>((resolve, reject) => {
        queued.push({ id: nextId++, task, resolve, reject });
        dispatch();
      }) as Promise<TaskResult<T>>;
    },
    dispose,
  };
}
