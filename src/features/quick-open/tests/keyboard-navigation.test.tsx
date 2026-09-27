// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { FileItem } from "@/features/file-search/types/file-search.types";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation";
import { FileListItem } from "../components/file-list-item";

vi.mock("@/extensions/icon-themes/components/themed-file-icon", () => ({
  ThemedFileIcon: () => null,
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));

const files: FileItem[] = ["first.ts", "second.ts", "third.ts"].map((name) => ({
  name,
  path: `/repo/${name}`,
  isDir: false,
}));
const onSelect = vi.fn();
const onClose = vi.fn();
let container: HTMLDivElement;
let root: Root;

function Search({ results }: { results: FileItem[] }) {
  const { selectedIndex, setSelectedIndex, handleInputKeyDown, scrollContainerRef } =
    useKeyboardNavigation({
      isVisible: true,
      allResults: [...results],
      onClose,
      onSelect,
    });
  return (
    <div ref={scrollContainerRef}>
      <input aria-label="Search files" onKeyDown={handleInputKeyDown} />
      {results.map((file, index) => (
        <FileListItem
          key={file.path}
          file={file}
          category="other"
          index={index}
          isSelected={index === selectedIndex}
          onClick={onSelect}
          onMouseMove={setSelectedIndex}
          rootFolderPath="/repo"
          searchQuery=""
        />
      ))}
    </div>
  );
}

async function press(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    container
      .querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  onSelect.mockClear();
  onClose.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("Quick Open keyboard navigation", () => {
  it("does not open files or close while confirming IME input", async () => {
    await act(async () => root.render(<Search results={files} />));
    await press("ArrowDown", { isComposing: true });
    await press("Enter", { isComposing: true });
    await press("Escape", { isComposing: true });
    await press("Enter", { keyCode: 229 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await press("Enter");
    expect(onSelect).toHaveBeenCalledWith("/repo/first.ts");
  });

  it("opens the same selected file when asynchronous results reorder", async () => {
    await act(async () => root.render(<Search results={files} />));
    await press("ArrowDown");
    await act(async () => root.render(<Search results={[files[2]!, files[0]!, files[1]!]} />));
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("second.ts");
    await press("Enter");
    expect(onSelect).toHaveBeenCalledWith("/repo/second.ts");
  });

  it("clamps a removed selection and handles empty results without opening a file", async () => {
    await act(async () => root.render(<Search results={files} />));
    await press("ArrowUp");
    await act(async () => root.render(<Search results={[files[0]!]} />));
    await press("Enter");
    expect(onSelect).toHaveBeenCalledWith("/repo/first.ts");
    onSelect.mockClear();
    await act(async () => root.render(<Search results={[]} />));
    await press("ArrowDown");
    await press("Enter");
    expect(onSelect).not.toHaveBeenCalled();
    await press("Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not let a row moving under the pointer replace keyboard selection", async () => {
    await act(async () => root.render(<Search results={files} />));
    await press("ArrowUp");
    const first = container.querySelector('[data-item-index="0"]')!;
    await act(async () => first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    await press("Enter");
    expect(onSelect).toHaveBeenLastCalledWith("/repo/third.ts");
    await act(async () => first.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
    await press("Enter");
    expect(onSelect).toHaveBeenLastCalledWith("/repo/first.ts");
  });
});
