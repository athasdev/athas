// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  lspSupported: true,
  getHover: vi.fn(),
}));

vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { isLspSupported: () => mocks.lspSupported },
}));
vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: { getInstance: () => mocks },
}));
vi.mock("@/features/editor/markdown/services/code-highlight", () => ({
  highlightMarkdownCodeBlocks: async (html: string) =>
    html.replace(
      '<code class="language-typescript">',
      '<code class="language-typescript"><span class="token-keyword">',
    ),
}));

const { getHoverBounds, lspHoverSource } = await import("../engines/codemirror/features/lsp-hover");

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  mocks.lspSupported = true;
  mocks.getHover.mockReset();
});

function container(width: number, height: number) {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: width });
  Object.defineProperty(element, "clientHeight", { value: height });
  return element;
}

describe("CodeMirror LSP hover", () => {
  it("clamps the hover to the editor like Monaco", () => {
    expect(getHoverBounds(container(1200, 900))).toEqual({ maxWidth: 500, maxHeight: 360 });
    expect(getHoverBounds(container(300, 200))).toEqual({ maxWidth: 280, maxHeight: 180 });
    expect(getHoverBounds(container(50, 20))).toEqual({ maxWidth: 120, maxHeight: 48 });
  });

  it("renders the server's hover as markdown over its range", async () => {
    mocks.getHover.mockResolvedValue({
      contents: { kind: "markdown", value: "```typescript\nconst a: number\n```\nThe **answer**." },
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
    });
    view = new EditorView({
      state: EditorState.create({ doc: "const a = 42;" }),
      parent: document.body,
    });
    const tooltip = await lspHoverSource("/repo/a.ts", container(800, 600))(view, 6, 1);

    expect(mocks.getHover).toHaveBeenCalledWith("/repo/a.ts", 0, 6);
    expect(tooltip && "pos" in tooltip ? [tooltip.pos, tooltip.end] : null).toEqual([6, 7]);
    const dom = (tooltip as { create: (view: EditorView) => { dom: HTMLElement } }).create(
      view,
    ).dom;
    expect(dom.classList.contains("cm-athas-hover")).toBe(true);
    expect(dom.style.getPropertyValue("--athas-hover-max-width")).toBe("500px");
    expect(dom.querySelector("strong")?.textContent).toBe("answer");
    expect(dom.querySelector("pre code")?.textContent).toBe("const a: number");
    await vi.waitFor(() => expect(dom.querySelector(".token-keyword")).not.toBeNull());
  });

  it("falls back to the word under the pointer and skips files without a server", async () => {
    mocks.getHover.mockResolvedValue({ contents: "plain" });
    view = new EditorView({ state: EditorState.create({ doc: "foo bar" }), parent: document.body });
    const tooltip = await lspHoverSource("/repo/a.ts", container(800, 600))(view, 5, 1);
    expect(tooltip && "pos" in tooltip ? [tooltip.pos, tooltip.end] : null).toEqual([4, 7]);

    mocks.lspSupported = false;
    expect(await lspHoverSource("/repo/a.ts", container(800, 600))(view, 5, 1)).toBeNull();
  });

  it("shows nothing for an empty hover", async () => {
    mocks.getHover.mockResolvedValue({ contents: [] });
    view = new EditorView({ state: EditorState.create({ doc: "foo" }), parent: document.body });
    expect(await lspHoverSource("/repo/a.ts", container(800, 600))(view, 1, 1)).toBeNull();
  });
});
