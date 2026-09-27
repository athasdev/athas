// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { TerminalSearch } from "../components/terminal-search";

vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
const onSearch = vi.fn();
const onNext = vi.fn();
const onPrevious = vi.fn();
const onClose = vi.fn();
const onBubble = vi.fn();
let root: Root;
let container: HTMLDivElement;

async function renderSearch(totalMatches = 2) {
  await act(async () =>
    root.render(
      <StrictMode>
        <div onKeyDown={onBubble}>
          <TerminalSearch
            isVisible
            onSearch={onSearch}
            onNext={onNext}
            onPrevious={onPrevious}
            onClose={onClose}
            currentMatch={1}
            totalMatches={totalMatches}
          />
        </div>
      </StrictMode>,
    ),
  );
}
async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => {
    container.querySelector("input")!.dispatchEvent(event);
  });
  return event;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await renderSearch();
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "needle",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Terminal search interactions", () => {
  it("runs one search for each option toggle in Strict Mode", async () => {
    onSearch.mockClear();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Match case"]')!.click(),
    );
    expect(onSearch).toHaveBeenCalledExactlyOnceWith("needle", {
      caseSensitive: true,
      wholeWord: false,
      regex: false,
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Match case"]')!.click(),
    );
    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(onSearch).toHaveBeenLastCalledWith("needle", {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
  });

  it("preserves IME confirmation and handles regular navigation without bubbling", async () => {
    for (const key of ["Enter", "Escape"]) await press(key, { isComposing: true });
    await press("Enter", { keyCode: 229 });
    expect(onNext).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    onBubble.mockClear();
    expect((await press("Enter")).defaultPrevented).toBe(true);
    await press("Enter", { shiftKey: true });
    await press("Escape");
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onBubble).not.toHaveBeenCalled();
  });

  it("does not navigate when no matches remain", async () => {
    await renderSearch(0);
    await press("Enter");
    await press("Enter", { shiftKey: true });
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();
  });
});
