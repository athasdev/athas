import type {
  TokenizerWorkerRequest,
  TokenizerWorkerResponse,
  TokenizerWorkerResult,
  ViewportRangePayload,
} from "./worker-protocol";
import type { HighlightToken } from "./types";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
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

    this.worker.onmessage = (event: MessageEvent<TokenizerWorkerResponse>) => {
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

  private post<T extends TokenizerWorkerResponse>(request: TokenizerWorkerRequest): Promise<T> {
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
    wasmPath?: string;
    highlightQueryUrl?: string;
    mode: "full" | "range";
    viewportRange?: ViewportRangePayload;
  }): Promise<TokenizerWorkerResult> {
    const id = ++this.requestId;
    const response = await this.post<Extract<TokenizerWorkerResponse, { ok: true }>>({
      id,
      type: "tokenize",
      ...params,
    });

    return {
      tokens: response.tokens ?? [],
      normalizedText: response.normalizedText ?? params.content,
    };
  }

  async tokenizeSnippet(snippet: string, languageId: string): Promise<HighlightToken[]> {
    const id = ++this.requestId;
    const response = await this.post<Extract<TokenizerWorkerResponse, { ok: true }>>({
      id,
      type: "tokenizeSnippet",
      snippet,
      languageId,
    });
    return response.tokens ?? [];
  }
}

export const tokenizerWorkerClient = new TokenizerWorkerClient();
