// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";
import { renderMarkdownBlocks } from "../markdown/markdown-block-dom";

function render(container: HTMLElement, blocks: string[]) {
  renderMarkdownBlocks(container, blocks);
  expect(container.innerHTML).toBe(blocks.join(""));
}

describe("renderMarkdownBlocks", () => {
  it("replaces only the blocks whose HTML changed", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>stale</p>";
    render(container, ["<h1>A</h1>", "\n<p>B</p>", "\n<p>C</p>"]);
    const [heading, , paragraph, , last] = [...container.childNodes];

    render(container, ["<h1>A</h1>", "\n<p>B changed</p>", "\n<p>C</p>"]);

    expect(container.childNodes[0]).toBe(heading);
    expect(container.childNodes[2]).not.toBe(paragraph);
    expect(container.childNodes[4]).toBe(last);
  });

  it("inserts, removes and keeps blocks around edits, including empty ones", () => {
    const container = document.createElement("div");
    render(container, ["<p>1</p>", "", "\n<p>2</p>", "\n<p>3</p>", "\n<p>4</p>"]);
    const kept = container.querySelectorAll("p")[2];

    render(container, ["<p>1</p>", "", "\n<p>new</p>", "\n<p>3</p>", "\n<p>4</p>", "\n<p>5</p>"]);
    expect(container.querySelectorAll("p")[2]).toBe(kept);

    render(container, ["", "\n<p>3</p>"]);
    expect(container.querySelector("p")).toBe(kept);

    render(container, []);
    expect(container.childNodes).toHaveLength(0);
  });

  it("keeps unchanged blocks between two separate edits", () => {
    const container = document.createElement("div");
    const blocks = Array.from({ length: 6 }, (_, index) => `<p>${index}</p>`);
    render(container, blocks);
    const middle = container.childNodes[3];

    render(container, [
      "<p>0</p>",
      "<p>one</p>",
      "<p>2</p>",
      "<p>3</p>",
      "<p>four</p>",
      "<p>5</p>",
    ]);
    expect(container.childNodes[3]).toBe(middle);
  });
});
