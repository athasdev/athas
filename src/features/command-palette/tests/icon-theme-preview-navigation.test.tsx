// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { IconThemeSelectorContent } from "../components/icon-theme-selector";

vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
vi.mock("@/extensions/appearance/appearance-preview", () => ({
  getIconThemeAppearancePreview: () => undefined,
}));
vi.mock("@/extensions/icon-themes/use-registered-icon-themes", () => {
  const themes = ["First", "Second", "Third"].map((name) => ({
    id: name.toLowerCase(),
    name,
    description: `${name} icons`,
  }));
  return { useRegisteredIconThemes: () => themes };
});

let container: HTMLDivElement;
let root: Root;
const onThemeChange = vi.fn();
const onClose = vi.fn();

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 0),
  );
  Element.prototype.scrollIntoView = vi.fn();
  onThemeChange.mockClear();
  onClose.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <IconThemeSelectorContent
        isActive
        onBack={vi.fn()}
        onClose={onClose}
        onThemeChange={onThemeChange}
        currentTheme="first"
      />,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function key(key: string, options: KeyboardEventInit = {}) {
  await act(async () =>
    container
      .querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options })),
  );
}

describe("Icon theme preview navigation", () => {
  it("does not change or commit a preview while composing a search", async () => {
    onThemeChange.mockClear();
    await key("ArrowDown", { isComposing: true });
    await key("Enter", { isComposing: true });
    await key("Escape", { isComposing: true });
    await key("Enter", { keyCode: 229 });
    expect(onThemeChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await key("Enter");
    expect(onThemeChange).toHaveBeenCalledWith("first");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves a keyboard preview when scrolling enters and leaves a row under a stationary pointer", async () => {
    await key("ArrowDown");
    expect(onThemeChange).toHaveBeenLastCalledWith("second");
    const second = container.querySelector('[data-index="1"]')!;
    const third = container.querySelector('[data-index="2"]')!;
    await act(async () => {
      second.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      third.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(onThemeChange).toHaveBeenLastCalledWith("second");
    expect(container.querySelector('[aria-selected="true"]')).toBe(second);
    await key("Escape");
    expect(onThemeChange).toHaveBeenLastCalledWith("first");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("previews a pointer choice once and commits it with Enter", async () => {
    const third = container.querySelector('[data-index="2"]')!;
    await act(async () => third.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
    expect(onThemeChange).toHaveBeenLastCalledWith("third");
    onThemeChange.mockClear();
    await act(async () => third.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
    expect(onThemeChange).not.toHaveBeenCalled();
    await key("Enter");
    expect(onThemeChange).toHaveBeenCalledWith("third");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
