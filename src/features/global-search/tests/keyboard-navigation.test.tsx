// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { FileItem } from "@/features/file-search/types/file-search.types";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation";

const files: FileItem[] = ["first:10", "second:20", "third:30"].map((path) => ({
  path,
  name: path,
  isDir: false,
}));
const onSelect = vi.fn();
const onClose = vi.fn();
let root: Root;
let container: HTMLDivElement;

function Search({ results, query = "same" }: { results: FileItem[]; query?: string }) {
  const { selectedIndex, handleKeyDown } = useKeyboardNavigation({
    isVisible: true,
    allResults: results,
    onSelect,
    onClose,
    resetKey: query,
    listenGlobally: false,
  });
  return (
    <input
      aria-label="Search"
      onKeyDown={handleKeyDown}
      data-selected={results[selectedIndex]?.path}
    />
  );
}

async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => {
    container.querySelector("input")!.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Global search result navigation", () => {
  it("opens the selected match after results reorder or grow", async () => {
    await act(async () => root.render(<Search results={files.slice(0, 2)} />));
    await press("ArrowDown");
    await act(async () => root.render(<Search results={[files[1]!, files[0]!]} />));
    expect(container.querySelector("input")!.dataset.selected).toBe("second:20");
    await act(async () => root.render(<Search results={[files[2]!, files[1]!, files[0]!]} />));
    await press("Enter");
    expect(onSelect).toHaveBeenCalledWith("second:20");
  });

  it("resets for a new query even when the old match is still present", async () => {
    await act(async () => root.render(<Search results={files} />));
    await press("ArrowDown");
    await act(async () => root.render(<Search results={files} query="new" />));
    await press("Enter");
    expect(onSelect).toHaveBeenCalledWith("first:10");
  });

  it("falls back when a match disappears and does not select empty results", async () => {
    await act(async () => root.render(<Search results={files} />));
    await press("ArrowUp");
    await act(async () => root.render(<Search results={[files[0]!]} />));
    await press("Enter");
    expect(onSelect).toHaveBeenCalledWith("first:10");
    onSelect.mockClear();
    await act(async () => root.render(<Search results={[]} />));
    await press("ArrowDown");
    await press("Enter");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("lets IME consume navigation, confirmation and cancellation", async () => {
    await act(async () => root.render(<Search results={files} />));
    for (const key of ["ArrowDown", "Enter", "Escape"]) {
      expect((await press(key, { isComposing: true })).defaultPrevented).toBe(false);
    }
    await press("Enter", { keyCode: 229 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await press("Enter");
    expect(onSelect).toHaveBeenCalledWith("first:10");
  });
});
