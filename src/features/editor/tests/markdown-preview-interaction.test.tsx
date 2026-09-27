// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MarkdownPreview } from "../markdown/markdown-preview";

const mocks = vi.hoisted(() => ({
  setActiveFindAdapter: vi.fn(),
  clearActiveFindAdapter: vi.fn(),
}));

vi.mock("@/features/editor/extensions/api", () => ({ editorAPI: mocks }));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: (selector: (state: unknown) => unknown) =>
    selector({
      activeBufferId: "markdown-buffer",
      buffers: [
        {
          id: "markdown-buffer",
          type: "editor",
          path: "/workspace/AGENTS.md",
          name: "AGENTS.md",
          content: "- **Item**",
        },
      ],
    }),
}));
vi.mock("@/features/editor/stores/settings.store", () => ({
  useEditorSettingsStore: { use: { fontSize: () => 14 } },
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { uiFontFamily: "sans-serif" } }),
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: (selector: (state: unknown) => unknown) =>
    selector({ rootFolderPath: "/workspace", handleFileSelect: vi.fn() }),
}));
vi.mock("../markdown/use-highlighted-markdown", () => ({
  useHighlightedMarkdown: () => "<ul><li><strong>Item</strong></li></ul>",
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  mocks.setActiveFindAdapter.mockClear();
  mocks.clearActiveFindAdapter.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Markdown preview interactions", () => {
  it("copies Markdown source when the entire preview is selected", async () => {
    await act(async () => root.render(<MarkdownPreview bufferId="markdown-buffer" />));
    const preview = host.querySelector<HTMLElement>("[data-markdown-preview]")!;
    const content = host.querySelector<HTMLElement>(".markdown-content")!;
    const selection = window.getSelection()!;
    expect(document.activeElement).toBe(preview);
    preview.blur();
    const partialRange = document.createRange();
    partialRange.selectNodeContents(content.querySelector("strong")!);
    selection.addRange(partialRange);
    await act(async () => preview.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(document.activeElement).not.toBe(preview);
    await act(async () => preview.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    expect(selection.toString()).toBe("Item");
    expect(document.activeElement).not.toBe(preview);
    const { selectAllActiveEditor } = await import("../../keymaps/commands/editor-command-actions");
    selectAllActiveEditor();
    expect(selection.rangeCount).toBe(1);
    expect(selection.toString()).toBe("Item");
    expect(selection.getRangeAt(0).startContainer).toBe(content);
    expect(selection.getRangeAt(0).endContainer).toBe(content);
    const setData = vi.fn();
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, "clipboardData", { value: { setData } });

    await act(async () => document.body.dispatchEvent(copyEvent));

    expect(copyEvent.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith("text/plain", "- **Item**");

    selection.removeAllRanges();
    partialRange.selectNodeContents(content.querySelector("strong")!);
    selection.addRange(partialRange);
    const partialCopyEvent = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(partialCopyEvent, "clipboardData", { value: { setData } });
    await act(async () => preview.dispatchEvent(partialCopyEvent));
    expect(partialCopyEvent.defaultPrevented).toBe(false);
    selection.removeAllRanges();
    await act(async () => preview.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    expect(document.activeElement).toBe(preview);
  });

  it("opens Find and highlights matches in rendered preview text", async () => {
    await act(async () => root.render(<MarkdownPreview bufferId="markdown-buffer" />));
    const adapter = mocks.setActiveFindAdapter.mock.calls[0]?.[0];
    expect(adapter).toBeDefined();

    await act(async () => adapter.openFind(false));
    const input = host.querySelector<HTMLInputElement>(
      'input[placeholder="Find in Markdown preview"]',
    );
    expect(input).not.toBeNull();
    if (!input) return;

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Item");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(host.querySelectorAll("[data-markdown-search-match]")).toHaveLength(1);
    expect(host.textContent).toContain("1 of 1");
  });
});
