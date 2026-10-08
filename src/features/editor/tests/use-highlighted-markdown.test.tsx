// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

interface WorkerRender {
  content: string;
  resolve: (markdown: { blocks: string[][] }) => void;
  reject: (error: unknown) => void;
}

const mocks = vi.hoisted(() => {
  class MarkdownRenderSupersededError extends Error {}
  class MarkdownRenderTimeoutError extends Error {}
  return {
    parseMarkdown: vi.fn<(content: string, options?: unknown) => string>(
      (content) => `<p>${content}</p>`,
    ),
    sanitizeMarkdownBlocks: vi.fn((markdown: { blocks: string[][] }) =>
      markdown.blocks.map((block) => block.join("")),
    ),
    highlightMarkdownCodeBlocks: vi.fn(async (html: string) =>
      html.replace("plain", "highlighted"),
    ),
    MarkdownRenderSupersededError,
    MarkdownRenderTimeoutError,
    offThread: false,
    workerRenders: [] as WorkerRender[],
  };
});

vi.mock("../markdown/services/parser", () => ({
  SourceSanitizeCache: class {
    forSource() {
      return {};
    }
  },
  parseMarkdownBlocks: (content: string, options: unknown) =>
    mocks.parseMarkdown(content, options).split("|"),
  sanitizeMarkdownBlocks: mocks.sanitizeMarkdownBlocks,
}));
vi.mock("../markdown/services/code-highlight", () => ({
  highlightMarkdownCodeBlocks: mocks.highlightMarkdownCodeBlocks,
}));
vi.mock("../markdown/markdown-render-client", () => ({
  MarkdownRenderSupersededError: mocks.MarkdownRenderSupersededError,
  MarkdownRenderTimeoutError: mocks.MarkdownRenderTimeoutError,
  markdownRenderClient: {
    canRenderOffThread: () => mocks.offThread,
    cancel: vi.fn(),
    render: (_key: string, content: string) =>
      new Promise((resolve, reject) => mocks.workerRenders.push({ content, resolve, reject })),
  },
}));

const { useHighlightedMarkdown } = await import("../markdown/hooks/use-highlighted-markdown");

const DELAY = 150;
let host: HTMLDivElement;
let root: Root;
let latestHtml = "";

function Preview({ content, sourceKey }: { content: string; sourceKey: string }) {
  latestHtml = useHighlightedMarkdown(content, { debounceMs: DELAY, sourceKey }).join("");
  return null;
}

function render(content: string, sourceKey = "/a.md") {
  act(() => root.render(<Preview content={content} sourceKey={sourceKey} />));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mocks.parseMarkdown.mockClear();
  mocks.parseMarkdown.mockImplementation((content: string) => `<p>${content}</p>`);
  mocks.highlightMarkdownCodeBlocks.mockClear();
  mocks.sanitizeMarkdownBlocks.mockClear();
  mocks.offThread = false;
  mocks.workerRenders = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("useHighlightedMarkdown", () => {
  it("parses the first content at once and edits after they pause", () => {
    render("one");
    expect(latestHtml).toBe("<p>one</p>");
    expect(mocks.parseMarkdown).toHaveBeenCalledTimes(1);

    render("one t");
    render("one tw");
    render("one two");
    expect(latestHtml).toBe("<p>one</p>");
    expect(mocks.parseMarkdown).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(DELAY));
    expect(latestHtml).toBe("<p>one two</p>");
    expect(mocks.parseMarkdown).toHaveBeenCalledTimes(2);
  });

  it("parses another source at once", () => {
    render("first file", "/a.md");
    render("second file", "/b.md");

    expect(latestHtml).toBe("<p>second file</p>");
  });

  it("keeps highlighted code up until the edited code is highlighted", async () => {
    mocks.parseMarkdown.mockImplementation((content: string) => block(content));

    render("a");
    await act(async () => {});
    expect(latestHtml).toBe('<pre><code class="language-ts">highlighted a</code></pre>');

    let resolve: (html: string) => void = () => {};
    mocks.highlightMarkdownCodeBlocks.mockImplementationOnce(
      () => new Promise<string>((done) => (resolve = done)),
    );
    render("ab");
    act(() => vi.advanceTimersByTime(DELAY));
    expect(latestHtml).toBe('<pre><code class="language-ts">highlighted a</code></pre>');

    await act(async () => resolve('<pre><code class="language-ts">highlighted ab</code></pre>'));
    expect(latestHtml).toBe('<pre><code class="language-ts">highlighted ab</code></pre>');
  });

  it("highlights only the code blocks an edit changed", async () => {
    mocks.parseMarkdown.mockImplementation((content: string) =>
      content
        .split(",")
        .map((code) => block(code))
        .join("|"),
    );
    render("a,b");
    await act(async () => {});
    expect(latestHtml).toBe(block("a", "highlighted") + block("b", "highlighted"));
    expect(mocks.highlightMarkdownCodeBlocks).toHaveBeenCalledTimes(2);

    render("a,c");
    act(() => vi.advanceTimersByTime(DELAY));
    await act(async () => {});
    expect(latestHtml).toBe(block("a", "highlighted") + block("c", "highlighted"));
    expect(mocks.highlightMarkdownCodeBlocks).toHaveBeenCalledTimes(3);
    expect(mocks.highlightMarkdownCodeBlocks).toHaveBeenLastCalledWith(
      block("c"),
      expect.any(String),
    );
  });

  it("shows another source's code at once while it is highlighted", async () => {
    mocks.parseMarkdown.mockImplementation((content: string) => block(content));
    render("a", "/a.md");
    await act(async () => {});
    expect(latestHtml).toBe(block("a", "highlighted"));

    mocks.highlightMarkdownCodeBlocks.mockImplementationOnce(() => new Promise<string>(() => {}));
    render("b", "/b.md");
    expect(latestHtml).toBe(block("b"));
  });

  it("shows new content at once when there is no debounce", async () => {
    mocks.parseMarkdown.mockImplementation((content: string) => block(content));
    act(() => root.render(<Undebounced content="a" />));
    await act(async () => {});
    expect(latestHtml).toBe(block("a", "highlighted"));

    mocks.highlightMarkdownCodeBlocks.mockImplementationOnce(() => new Promise<string>(() => {}));
    act(() => root.render(<Undebounced content="ab" />));
    expect(latestHtml).toBe(block("ab"));
  });
});

describe("useHighlightedMarkdown with a render worker", () => {
  beforeEach(() => {
    mocks.offThread = true;
  });

  it("parses the first content here and debounced edits in the worker", async () => {
    render("one");
    expect(latestHtml).toBe("<p>one</p>");
    expect(mocks.workerRenders).toHaveLength(0);

    render("one two");
    act(() => vi.advanceTimersByTime(DELAY));
    expect(mocks.parseMarkdown).toHaveBeenCalledTimes(1);
    expect(mocks.workerRenders.map((request) => request.content)).toEqual(["one two"]);
    expect(latestHtml).toBe("<p>one</p>");

    await act(async () => mocks.workerRenders[0].resolve({ blocks: [["<p>one two</p>"]] }));
    expect(latestHtml).toBe("<p>one two</p>");
    expect(mocks.sanitizeMarkdownBlocks.mock.calls[0][0]).toEqual({ blocks: [["<p>one two</p>"]] });
  });

  it("ignores a worker result that a newer edit has replaced", async () => {
    render("a");
    render("ab");
    act(() => vi.advanceTimersByTime(DELAY));
    render("abc");
    act(() => vi.advanceTimersByTime(DELAY));
    expect(mocks.workerRenders.map((request) => request.content)).toEqual(["ab", "abc"]);

    await act(async () => mocks.workerRenders[1].resolve({ blocks: [["<p>abc</p>"]] }));
    await act(async () => mocks.workerRenders[0].resolve({ blocks: [["<p>ab</p>"]] }));
    expect(latestHtml).toBe("<p>abc</p>");
  });

  it("drops superseded renders and parses here when the worker fails", async () => {
    render("a");
    render("ab");
    act(() => vi.advanceTimersByTime(DELAY));
    await act(async () => mocks.workerRenders[0].reject(new mocks.MarkdownRenderSupersededError()));
    expect(latestHtml).toBe("<p>a</p>");
    expect(mocks.parseMarkdown).toHaveBeenCalledTimes(1);

    render("abc");
    act(() => vi.advanceTimersByTime(DELAY));
    await act(async () => mocks.workerRenders[1].reject(new Error("worker crashed")));
    expect(latestHtml).toBe("<p>abc</p>");
    expect(mocks.parseMarkdown).toHaveBeenLastCalledWith("abc", { frontMatter: undefined });
  });

  it("keeps the last preview when a worker render times out", async () => {
    render("a");
    render("ab");
    act(() => vi.advanceTimersByTime(DELAY));
    await act(async () => mocks.workerRenders[0].reject(new mocks.MarkdownRenderTimeoutError()));

    expect(latestHtml).toBe("<p>a</p>");
    expect(mocks.parseMarkdown).toHaveBeenCalledTimes(1);
  });

  it("parses another source here instead of waiting for the worker", () => {
    render("first", "/a.md");
    render("second", "/b.md");
    expect(latestHtml).toBe("<p>second</p>");
    expect(mocks.workerRenders).toHaveLength(0);
  });
});

function block(code: string, state = "plain") {
  return `<pre><code class="language-ts">${state} ${code}</code></pre>`;
}

function Undebounced({ content }: { content: string }) {
  latestHtml = useHighlightedMarkdown(content).join("");
  return null;
}
