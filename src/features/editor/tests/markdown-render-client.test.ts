import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  MarkdownRenderClient,
  MarkdownRenderSupersededError,
  MarkdownRenderTimeoutError,
  type MarkdownRenderRequest,
  type MarkdownRenderResponse,
} from "../markdown/markdown-render-client";
import { renderMarkdown } from "../markdown/render-markdown";

class FakeWorker {
  posted: MarkdownRenderRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<MarkdownRenderResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  postMessage(request: MarkdownRenderRequest) {
    this.posted.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  respond(request: MarkdownRenderRequest) {
    this.onmessage?.({
      data: { id: request.id, ok: true, markdown: renderMarkdown(request.content) },
    } as MessageEvent<MarkdownRenderResponse>);
  }

  fail() {
    this.onerror?.({ preventDefault() {} } as ErrorEvent);
  }
}

function createClient() {
  const worker = new FakeWorker();
  const client = new MarkdownRenderClient(() => worker as unknown as Worker);
  return { client, worker };
}

function settle<T>(promise: Promise<T>) {
  const state: { value?: T; error?: unknown; done: boolean } = { done: false };
  promise.then(
    (value) => Object.assign(state, { value, done: true }),
    (error: unknown) => Object.assign(state, { error, done: true }),
  );
  return state;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("MarkdownRenderClient", () => {
  it("runs one render per key and keeps only the latest waiting request", async () => {
    const { client, worker } = createClient();
    const first = settle(client.render("preview", "# one"));
    const second = settle(client.render("preview", "# two"));
    const third = settle(client.render("preview", "# three"));

    expect(worker.posted.map((request) => request.content)).toEqual(["# one"]);
    await flush();
    expect(second.error).toBeInstanceOf(MarkdownRenderSupersededError);

    worker.respond(worker.posted[0]);
    await flush();
    expect(first.error).toBeInstanceOf(MarkdownRenderSupersededError);
    expect(worker.posted.map((request) => request.content)).toEqual(["# one", "# three"]);

    worker.respond(worker.posted[1]);
    await flush();
    expect(third.value).toEqual(renderMarkdown("# three"));
  });

  it("drops responses that are stale or unknown", async () => {
    const { client, worker } = createClient();
    const first = settle(client.render("preview", "a"));
    const [request] = worker.posted;

    worker.onmessage?.({
      data: { id: request.id + 100, ok: true, markdown: { blocks: [["<p>other</p>"]] } },
    } as MessageEvent<MarkdownRenderResponse>);
    await flush();
    expect(first.done).toBe(false);

    client.cancel("preview");
    worker.respond(request);
    await flush();
    expect(first.error).toBeInstanceOf(MarkdownRenderSupersededError);
  });

  it("does not let one key supersede another", async () => {
    const { client, worker } = createClient();
    const left = settle(client.render("left", "left"));
    const right = settle(client.render("right", "right"));
    expect(worker.posted).toHaveLength(2);

    worker.respond(worker.posted[1]);
    worker.respond(worker.posted[0]);
    await flush();
    expect(left.value).toEqual(renderMarkdown("left"));
    expect(right.value).toEqual(renderMarkdown("right"));
  });

  it("renders on the calling thread without a worker", async () => {
    const client = new MarkdownRenderClient(() => null);
    expect(await client.render("preview", "**bold**")).toEqual(renderMarkdown("**bold**"));
  });

  it("finishes the latest request on the calling thread when the worker fails", async () => {
    const { client, worker } = createClient();
    const first = settle(client.render("preview", "first"));
    const latest = settle(client.render("preview", "latest"));

    worker.fail();
    await flush();
    expect(worker.terminated).toBe(true);
    expect(first.error).toBeInstanceOf(MarkdownRenderSupersededError);
    expect(latest.value).toEqual(renderMarkdown("latest"));
    expect(client.canRenderOffThread()).toBe(false);
  });

  describe("when a render hangs", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("rejects it, replaces the worker and reruns the other renders", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("Worker", FakeWorker);
      const workers: FakeWorker[] = [];
      const client = new MarkdownRenderClient(() => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      }, 1_000);
      const stuck = settle(client.render("left", "stuck"));
      const other = settle(client.render("right", "other"));
      const next = settle(client.render("left", "next"));

      vi.advanceTimersByTime(1_000);
      await Promise.resolve();

      expect(stuck.error).toBeInstanceOf(MarkdownRenderTimeoutError);
      expect(workers[0].terminated).toBe(true);
      expect(workers[1].posted.map((request) => request.content)).toEqual(["other", "next"]);
      expect(client.canRenderOffThread()).toBe(true);

      for (const request of workers[1].posted) workers[1].respond(request);
      await Promise.resolve();
      await Promise.resolve();
      expect(other.value).toEqual(renderMarkdown("other"));
      expect(next.value).toEqual(renderMarkdown("next"));
    });

    it("does not time out a render that returned", async () => {
      vi.useFakeTimers();
      const worker = new FakeWorker();
      const client = new MarkdownRenderClient(() => worker as unknown as Worker, 1_000);
      const done = settle(client.render("preview", "fast"));
      worker.respond(worker.posted[0]);
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();

      expect(done.value).toEqual(renderMarkdown("fast"));
      expect(worker.terminated).toBe(false);
    });
  });
});
