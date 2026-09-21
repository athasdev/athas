import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  TokenizerRequestSupersededError,
  TokenizerWorkerClient,
} from "../lib/wasm-parser/tokenizer-worker-client";
import type {
  TokenizerWorkerRequest,
  TokenizerWorkerResponse,
} from "../lib/wasm-parser/worker-protocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<TokenizerWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: TokenizerWorkerRequest[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: TokenizerWorkerRequest) {
    this.messages.push(message);
  }

  respond(index: number) {
    const request = this.messages[index];
    if (!request) throw new Error(`Missing request ${index}`);
    this.onmessage?.({
      data: {
        id: request.id,
        ok: true,
        tokens: [],
        normalizedText: request.type === "tokenize" ? request.content : undefined,
      },
    } as unknown as MessageEvent<TokenizerWorkerResponse>);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe("TokenizerWorkerClient", () => {
  it("keeps one request in flight per key and coalesces queued stale work", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = new TokenizerWorkerClient();
    const request = (content: string) =>
      client.tokenize({
        bufferId: "buffer",
        latestKey: "surface",
        content,
        languageId: "typescript",
        mode: "full",
      });

    const first = request("first");
    const second = request("second");
    const third = request("third");
    const firstResult = expect(first).rejects.toBeInstanceOf(TokenizerRequestSupersededError);
    const secondResult = expect(second).rejects.toBeInstanceOf(TokenizerRequestSupersededError);
    const worker = FakeWorker.instances[0];

    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0]).toEqual(expect.objectContaining({ content: "first" }));
    worker.respond(0);
    await firstResult;
    await secondResult;
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
    expect(worker.messages[1]).toEqual(expect.objectContaining({ content: "third" }));

    worker.respond(1);
    await expect(third).resolves.toEqual({ tokens: [], normalizedText: "third" });
  });
});
