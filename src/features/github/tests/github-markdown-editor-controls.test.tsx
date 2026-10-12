// @vitest-environment jsdom
import { within } from "@testing-library/dom";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GitHubMarkdownEditor } from "../components/github-markdown-editor";

let root: Root;
let host: HTMLDivElement;
let latestValue = "";

async function settle() {
  await act(async () => {
    for (let index = 0; index < 6; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  latestValue = value;
  return <GitHubMarkdownEditor value={value} onChange={setValue} />;
}

async function render(initial = "") {
  await act(async () => root.render(<Harness initial={initial} />));
  await settle();
}

function editor() {
  const element = host.querySelector<HTMLElement>("[contenteditable]") as HTMLElement & {
    __lexicalEditor: LexicalEditor;
  };
  return element.__lexicalEditor;
}

async function writeAndSelect(text: string, select: (node: TextNode) => void) {
  await act(async () => {
    host.querySelector<HTMLElement>("[contenteditable]")?.focus();
    editor().update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const node = $createTextNode(text);
      paragraph.append(node);
      root.append(paragraph);
      select(node);
    });
  });
  await settle();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

const option = (label: string) =>
  within(document.body)
    .getAllByRole("option")
    .find((element) => element.textContent?.includes(label)) as HTMLElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  latestValue = "";
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 120,
      bottom: 140,
      left: 200,
      right: 260,
      width: 60,
      height: 20,
      x: 200,
      y: 120,
    }) as DOMRect;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.getAnimations = () => [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("GitHub Markdown editor controls", () => {
  it("offers block commands after a slash and filters them", async () => {
    await render();

    await writeAndSelect("/", (node) => node.select(1, 1));
    expect(within(document.body).getByRole("listbox", { name: "block commands" })).toBeTruthy();
    expect(option("heading 1")).toBeTruthy();
    expect(option("bulleted list")).toBeTruthy();

    await writeAndSelect("/zzzz", (node) => node.select(5, 5));
    expect(within(document.body).getByText("no matching blocks")).toBeTruthy();
  });

  it.each([
    ["text", ""],
    ["heading 1", "#"],
    ["heading 2", "##"],
    ["heading 3", "###"],
    ["quote", ">"],
    ["bulleted list", "*"],
    ["numbered list", "1."],
    ["task list", "*"],
    ["code block", "```text\n```"],
    ["divider", "***"],
    ["table", "|   |   |   |\n| - | - | - |\n|   |   |   |\n|   |   |   |"],
  ])("runs the %s command from the slash menu", async (label, markdown) => {
    await render();

    await writeAndSelect("/", (node) => node.select(1, 1));
    await act(async () => {
      (option(label).firstElementChild as HTMLElement).click();
    });
    await settle();

    expect(latestValue.trim()).toBe(markdown);
    expect(within(document.body).queryByRole("listbox", { name: "block commands" })).toBeNull();
  });

  it("makes a task list item checkable", async () => {
    await render();

    await writeAndSelect("/task", (node) => node.select(5, 5));
    await act(async () => {
      (option("task list").firstElementChild as HTMLElement).click();
    });
    await settle();

    expect(host.querySelector("li[role='checkbox']")?.getAttribute("aria-checked")).toBe("false");
  });

  it("shows formatting controls above a text selection", async () => {
    await render("plain words");

    await writeAndSelect("plain words", (node) => node.select(0, 5));
    const toolbar = within(document.body).getByRole("toolbar", { name: "text formatting" });
    expect(toolbar.getAttribute("data-placement")).toBe("above");

    expect(
      [...toolbar.querySelectorAll("button, [role='radio'], [role='button']")].map(
        (element) => element.getAttribute("aria-label") ?? element.getAttribute("title"),
      ),
    ).toEqual(["Bold", "Italic", "Strikethrough", "Inline code format", "Create link"]);

    await writeAndSelect("plain words", (node) => node.select(2, 2));
    expect(within(document.body).queryByRole("toolbar", { name: "text formatting" })).toBeNull();
  });

  it("places the formatting controls below a selection near the top edge", async () => {
    Range.prototype.getBoundingClientRect = () =>
      ({ top: 10, bottom: 30, left: 0, right: 40, width: 40, height: 20, x: 0, y: 10 }) as DOMRect;
    await render("plain words");

    await writeAndSelect("plain words", (node) => node.select(6, 11));

    const toolbar = within(document.body).getByRole("toolbar", { name: "text formatting" });
    expect(toolbar.getAttribute("data-placement")).toBe("below");
  });
});
