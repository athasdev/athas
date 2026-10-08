// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation";
import { QuickOpenItemRow } from "../components/quick-open-item-row";
import type { QuickOpenItem } from "../types/quick-open.types";

const onSelect = vi.fn();
const onClose = vi.fn();
const onCycleSection = vi.fn();
const files: QuickOpenItem[] = ["first.ts", "second.ts", "third.ts"].map((name) => ({
  key: `/repo/${name}`,
  icon: null,
  title: name,
  select: () => onSelect(`/repo/${name}`),
}));
let container: HTMLDivElement;
let root: Root;

function Search({ results }: { results: QuickOpenItem[] }) {
  const { selectedIndex, setSelectedIndex, handleInputKeyDown, scrollContainerRef } =
    useKeyboardNavigation({
      isVisible: true,
      allResults: [...results],
      onClose,
      onSelect: (item) => item.select(),
      onCycleSection,
    });
  return (
    <div ref={scrollContainerRef}>
      <input aria-label="Search files" onKeyDown={handleInputKeyDown} />
      {results.map((item, index) => (
        <QuickOpenItemRow
          key={item.key}
          item={item}
          index={index}
          isSelected={index === selectedIndex}
          onHover={setSelectedIndex}
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
  onCycleSection.mockClear();
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

  it("moves between sections with Tab and Shift+Tab", async () => {
    await act(async () => root.render(<Search results={files} />));
    await press("Tab");
    await press("Tab", { shiftKey: true });
    expect(onCycleSection.mock.calls).toEqual([[1], [-1]]);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
