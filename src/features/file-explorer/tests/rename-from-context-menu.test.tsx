// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ContextMenuPopup } from "@/ui/context-menu";

let root: Root;
let container: HTMLDivElement;

function Harness() {
  const [isOpen, setIsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  return (
    <>
      <button type="button" data-testid="editor" onClick={() => setIsOpen(true)}>
        editor
      </button>
      {renaming ? <input aria-label="Rename notes.txt" autoFocus /> : null}
      <ContextMenuPopup
        isOpen={isOpen}
        point={{ x: 10, y: 10 }}
        onClose={() => setIsOpen(false)}
        groups={[
          {
            id: "file",
            items: [{ id: "rename", label: "Rename", onClick: () => setRenaming(true) }],
          },
        ]}
      />
    </>
  );
}

const editor = () => document.querySelector<HTMLButtonElement>('[data-testid="editor"]')!;
const menuItem = () => document.querySelector<HTMLElement>('[role="menuitem"]')!;

async function openMenu() {
  await act(async () => {
    editor().focus();
    editor().click();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.getAnimations = () => [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// The file tree's Rename item focuses an inline field; the context menu must not take focus back
// as it closes, or the blur submits the rename before anything is typed.
describe("renaming from a context menu", () => {
  it("keeps the rename field focused after the menu closes", async () => {
    await openMenu();
    await act(async () => menuItem().click());
    await settle();

    expect(document.activeElement?.getAttribute("aria-label")).toBe("Rename notes.txt");
  });

  it("still returns focus when the menu is dismissed without a choice", async () => {
    await openMenu();
    expect(menuItem()).toBeTruthy();
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settle();

    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    expect(document.activeElement).toBe(editor());
  });
});
