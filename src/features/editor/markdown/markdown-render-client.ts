import {
  renderMarkdown,
  type ParseMarkdownOptions,
  type UnsanitizedMarkdown,
} from "./render-markdown";

export interface MarkdownRenderRequest {
  id: number;
  content: string;
  options: ParseMarkdownOptions;
}

export type MarkdownRenderResponse =
  | { id: number; ok: true; markdown: UnsanitizedMarkdown }
  | { id: number; ok: false; error: string };

interface PendingRender extends MarkdownRenderRequest {
  key: string;
  resolve: (markdown: UnsanitizedMarkdown) => void;
  reject: (reason: unknown) => void;
}

export class MarkdownRenderSupersededError extends Error {
  constructor() {
    super("Markdown render was superseded by a newer request");
    this.name = "MarkdownRenderSupersededError";
  }
}

function createMarkdownRenderWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./markdown-render-worker.ts", import.meta.url), { type: "module" });
}

/**
 * Renders markdown in a worker. Each key keeps at most one render running and one waiting; a newer
 * request replaces the waiting one, and a response for anything but the key's latest request is
 * dropped. Without a worker (tests, or after the worker fails) it renders on the calling thread.
 */
export class MarkdownRenderClient {
  private worker: Worker | null = null;
  private workerFailed = false;
  private nextId = 0;
  private readonly latestIds = new Map<string, number>();
  private readonly running = new Map<number, PendingRender>();
  private readonly runningKeys = new Set<string>();
  private readonly waiting = new Map<string, PendingRender>();

  constructor(private readonly createWorker: () => Worker | null = createMarkdownRenderWorker) {}

  render(key: string, content: string, options: ParseMarkdownOptions = {}) {
    return new Promise<UnsanitizedMarkdown>((resolve, reject) => {
      const request: PendingRender = { id: ++this.nextId, key, content, options, resolve, reject };
      this.latestIds.set(key, request.id);
      this.waiting.get(key)?.reject(new MarkdownRenderSupersededError());
      this.waiting.delete(key);
      if (this.runningKeys.has(key)) this.waiting.set(key, request);
      else this.dispatch(request);
    });
  }

  canRenderOffThread() {
    return !this.workerFailed && typeof Worker !== "undefined";
  }

  /** Drops the key's waiting request; a running one is discarded when it returns. */
  cancel(key: string) {
    this.latestIds.delete(key);
    this.waiting.get(key)?.reject(new MarkdownRenderSupersededError());
    this.waiting.delete(key);
  }

  private dispatch(request: PendingRender) {
    const worker = this.getWorker();
    if (!worker) {
      this.renderHere(request);
      return;
    }
    this.running.set(request.id, request);
    this.runningKeys.add(request.key);
    const message: MarkdownRenderRequest = {
      id: request.id,
      content: request.content,
      options: request.options,
    };
    worker.postMessage(message);
  }

  private getWorker() {
    if (this.worker || this.workerFailed) return this.worker;
    try {
      this.worker = this.createWorker();
    } catch {
      this.worker = null;
    }
    if (!this.worker) {
      this.workerFailed = true;
      return null;
    }
    this.worker.onmessage = (event: MessageEvent<MarkdownRenderResponse>) =>
      this.handleResponse(event.data);
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.handleWorkerFailure();
    };
    this.worker.onmessageerror = () => this.handleWorkerFailure();
    return this.worker;
  }

  private handleResponse(response: MarkdownRenderResponse) {
    const request = this.running.get(response.id);
    if (!request) return;
    this.running.delete(response.id);
    this.runningKeys.delete(request.key);

    if (this.latestIds.get(request.key) !== request.id) {
      request.reject(new MarkdownRenderSupersededError());
    } else {
      this.latestIds.delete(request.key);
      if (response.ok) request.resolve(response.markdown);
      else request.reject(new Error(response.error));
    }

    const next = this.waiting.get(request.key);
    if (!next) return;
    this.waiting.delete(request.key);
    this.dispatch(next);
  }

  private handleWorkerFailure() {
    this.workerFailed = true;
    this.worker?.terminate();
    this.worker = null;
    const pending = [...this.running.values(), ...this.waiting.values()];
    this.running.clear();
    this.runningKeys.clear();
    this.waiting.clear();
    for (const request of pending) {
      if (this.latestIds.get(request.key) === request.id) this.renderHere(request);
      else request.reject(new MarkdownRenderSupersededError());
    }
  }

  private renderHere(request: PendingRender) {
    if (this.latestIds.get(request.key) === request.id) this.latestIds.delete(request.key);
    try {
      request.resolve(renderMarkdown(request.content, request.options));
    } catch (error) {
      request.reject(error);
    }
  }
}

export const markdownRenderClient = new MarkdownRenderClient();
