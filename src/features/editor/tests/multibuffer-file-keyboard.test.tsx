// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MultibufferFileStepper } from "../components/multibuffer/multibuffer-file-stepper";

vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));

const items = ["first.ts", "second.ts", "third.ts"].map((path) => ({ key: path, path }));
const onSelect = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  onSelect.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(isActive = true, selectedKey = "second.ts") {
  await act(async () =>
    root.render(
      <MultibufferFileStepper
        items={items}
        selectedKey={selectedKey}
        onSelect={onSelect}
        isActive={isActive}
      />,
    ),
  );
}

function press(target: EventTarget, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("Multibuffer file keyboard navigation", () => {
  it("navigates only while the review is active and respects file boundaries", async () => {
    await render();
    press(container, "j");
    expect(onSelect).toHaveBeenLastCalledWith("first.ts");
    press(container, "k");
    expect(onSelect).toHaveBeenLastCalledWith("third.ts");
    onSelect.mockClear();

    await render(false);
    press(container, "k");
    expect(onSelect).not.toHaveBeenCalled();

    await render(true, "first.ts");
    press(container, "j");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("leaves typing and overlay navigation to the focused control", async () => {
    await render();
    for (const markup of [
      "<input />",
      "<textarea></textarea>",
      '<div contenteditable="true"><span>Draft</span></div>',
      '<div role="menu"><button role="menuitem">Keep</button></div>',
      '<div role="listbox"><div role="option">JavaScript</div></div>',
      '<div role="dialog"><button>Keep</button></div>',
    ]) {
      const overlay = document.createElement("div");
      overlay.innerHTML = markup;
      container.append(overlay);
      const target = overlay.querySelector("span, button, [role=option]") ?? overlay.firstChild!;
      press(target, "j");
      press(target, "k");
      overlay.remove();
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("respects a keyboard event already handled by the focused surface", async () => {
    await render();
    const control = document.createElement("button");
    control.addEventListener("keydown", (event) => event.preventDefault());
    container.append(control);
    press(control, "k");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
