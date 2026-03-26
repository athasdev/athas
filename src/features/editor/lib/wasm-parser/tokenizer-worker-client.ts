import type { HighlightToken } from "./types";

interface ViewportRangePayload {
  startLine: number;
  endLine: number;
}

type WorkerRequest =
  | { id: number; type: "warmup"; languages?: string[] }
  | { id: number; type: "reset"; bufferId: string }
  | {
      id: number;
      type: "tokenize";
      bufferId: string;
      content: string;
      languageId: string;
      mode: "full" | "range";
      viewportRange?: ViewportRangePayload;
    };

type WorkerResponse =
  | {
      id: number;
      ok: true;
      tokens?: HighlightToken[];
      normalizedText?: string;
    }
  | { id: number; ok: false; error: string };

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
}

export interface TokenizerWorkerResult {
  tokens: HighlightToken[];
  normalizedText: string;
}

class TokenizerWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    this.worker = new Worker(new URL("./tokenizer-worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);

      if (message.ok) {
        pending.resolve(message);
      } else {
        pending.reject(new Error(message.error));
      }
    };

    this.worker.onerror = (event) => {
      const error = event.error || new Error(event.message);
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    };

    return this.worker;
  }

  private post<T extends WorkerResponse>(request: WorkerRequest): Promise<T> {
    const worker = this.ensureWorker();

    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      worker.postMessage(request);
    });
  }

  async warmup(languages?: string[]): Promise<void> {
    const id = ++this.requestId;
    await this.post({ id, type: "warmup", languages });
  }

  async reset(bufferId: string): Promise<void> {
    const id = ++this.requestId;
    await this.post({ id, type: "reset", bufferId });
  }

  async tokenize(params: {
    bufferId: string;
    content: string;
    languageId: string;
    mode: "full" | "range";
    viewportRange?: ViewportRangePayload;
  }): Promise<TokenizerWorkerResult> {
    const id = ++this.requestId;
    const response = await this.post<Extract<WorkerResponse, { ok: true }>>({
      id,
      type: "tokenize",
      ...params,
    });

    return {
      tokens: response.tokens ?? [],
      normalizedText: response.normalizedText ?? params.content,
    };
  }
}

export const tokenizerWorkerClient = new TokenizerWorkerClient();
