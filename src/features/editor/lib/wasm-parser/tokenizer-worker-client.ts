import type {
  TokenizerWorkerRequest,
  TokenizerWorkerResponse,
  TokenizerWorkerResult,
  ViewportRangePayload,
} from "./worker-protocol";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
}

interface TokenizeParams {
  bufferId: string;
  content: string;
  languageId: string;
  wasmPath?: string;
  highlightQuery?: string;
  highlightQueryUrl?: string;
  mode: "full" | "range";
  viewportRange?: ViewportRangePayload;
  latestKey?: string;
}

interface LatestRequest {
  params: TokenizeParams;
  generation: number;
  resolve: (value: TokenizerWorkerResult) => void;
  reject: (reason?: unknown) => void;
}

interface LatestRequestState {
  generation: number;
  running: boolean;
  queued?: LatestRequest;
}

export class TokenizerRequestSupersededError extends Error {
  constructor() {
    super("Tokenizer request was superseded");
    this.name = "TokenizerRequestSupersededError";
  }
}

export class TokenizerWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private latestRequests = new Map<string, LatestRequestState>();

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

  async reset(bufferId: string): Promise<void> {
    const id = ++this.requestId;
    await this.post({ id, type: "reset", bufferId });
  }

  private async tokenizeImmediately(params: TokenizeParams): Promise<TokenizerWorkerResult> {
    const id = ++this.requestId;
    const response = await this.post<Extract<TokenizerWorkerResponse, { ok: true }>>({
      id,
      type: "tokenize",
      bufferId: params.bufferId,
      content: params.content,
      languageId: params.languageId,
      wasmPath: params.wasmPath,
      highlightQuery: params.highlightQuery,
      highlightQueryUrl: params.highlightQueryUrl,
      mode: params.mode,
      viewportRange: params.viewportRange,
    });

    return {
      tokens: response.tokens ?? [],
      normalizedText: response.normalizedText ?? params.content,
    };
  }

  private runLatestRequest(key: string, request: LatestRequest) {
    const state = this.latestRequests.get(key);
    if (!state) return;
    state.running = true;

    void this.tokenizeImmediately(request.params)
      .then((result) => {
        if (request.generation === state.generation) {
          request.resolve(result);
        } else {
          request.reject(new TokenizerRequestSupersededError());
        }
      })
      .catch(request.reject)
      .finally(() => {
        const queued = state.queued;
        state.queued = undefined;
        if (queued) {
          this.runLatestRequest(key, queued);
        } else {
          this.latestRequests.delete(key);
        }
      });
  }

  tokenize(params: TokenizeParams): Promise<TokenizerWorkerResult> {
    const key = params.latestKey;
    if (!key) return this.tokenizeImmediately(params);

    return new Promise((resolve, reject) => {
      const state = this.latestRequests.get(key) ?? { generation: 0, running: false };
      const generation = state.generation + 1;
      state.generation = generation;
      const request = { params, generation, resolve, reject };

      if (state.running) {
        state.queued?.reject(new TokenizerRequestSupersededError());
        state.queued = request;
        this.latestRequests.set(key, state);
        return;
      }

      this.latestRequests.set(key, state);
      this.runLatestRequest(key, request);
    });
  }
}

export const tokenizerWorkerClient = new TokenizerWorkerClient();
