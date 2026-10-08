// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  parseMarkdown: vi.fn((content: string) => `<p>${content}</p>`),
  highlightMarkdownCodeBlocks: vi.fn(async (html: string) => html.replace("plain", "highlighted")),
}));

vi.mock("../markdown/parser", () => ({ parseMarkdown: mocks.parseMarkdown }));
vi.mock("../markdown/code-highlight", () => ({
  highlightMarkdownCodeBlocks: mocks.highlightMarkdownCodeBlocks,
}));

const { useHighlightedMarkdown } = await import("../markdown/use-highlighted-markdown");

const DELAY = 150;
let host: HTMLDivElement;
let root: Root;
let latestHtml = "";

function Preview({ content, sourceKey }: { content: string; sourceKey: string }) {
  latestHtml = useHighlightedMarkdown(content, { debounceMs: DELAY, sourceKey });
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

function block(code: string, state = "plain") {
  return `<pre><code class="language-ts">${state} ${code}</code></pre>`;
}

function Undebounced({ content }: { content: string }) {
  latestHtml = useHighlightedMarkdown(content);
  return null;
}
