// @vitest-environment jsdom
import { within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    opened: [] as string[],
    clipboard: [] as string[],
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: async (url: string) => {
    mocks.opened.push(url);
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: async (text: string) => {
    mocks.clipboard.push(text);
  },
}));

import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import MarkdownRenderer from "../components/messages/markdown-renderer";

enableMapSet();

const last = <T,>(items: T[]) => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;
let openedFiles: { path: string; line?: number; column?: number }[];

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(content: string, props: { isStreaming?: boolean } = {}) {
  await act(async () => root.render(<MarkdownRenderer content={content} {...props} />));
  await flush();
}

const view = () => within(container);
const link = (text: string) => view().getByText(text).closest("a")!;

async function click(element: Element) {
  let event!: MouseEvent;
  await act(async () => {
    event = new MouseEvent("click", { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
  });
  await flush();
  return event;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  mocks.opened.length = 0;
  mocks.clipboard.length = 0;
  openedFiles = [];
  useProjectStore.setState({ rootFolderPath: "/repo" });
  useFileSystemStore.setState({
    getAllProjectFiles: async () => [
      { name: "app.ts", path: "/repo/src/app.ts", isDir: false },
      { name: "README.md", path: "/repo/README.md", isDir: false },
    ],
    handleFileSelect: async (path: string, _isDir: boolean, line?: number, column?: number) => {
      openedFiles.push({ path, line, column });
    },
  } as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("markdown renderer", () => {
  it("renders model HTML as text instead of markup", async () => {
    await render(
      'Look: <img src=x onerror="alert(1)"> and <script>alert(2)</script>\n\n<b>bold?</b>',
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.textContent).toContain("<script>alert(2)</script>");
  });

  it("neutralizes javascript links instead of navigating", async () => {
    await render("[click me](javascript:alert(document.cookie))");

    const anchor = link("click me");
    expect(anchor.getAttribute("href")).not.toBe("javascript:alert(document.cookie)");
    const event = await click(anchor);
    expect(event.defaultPrevented).toBe(true);
    expect(openedFiles).toEqual([]);
    expect(mocks.opened).toEqual([]);
  });

  it("never hands schemes outside web, mail and phone links to the system opener", async () => {
    await render(
      "[a](vbscript:msgbox) [b](data:text/html,hi) [c](file:///etc/passwd) [d](smb://host/share)",
    );

    for (const name of ["a", "b", "c", "d"]) await click(link(name));

    expect(mocks.opened).toEqual([]);
    expect(openedFiles).toEqual([]);
  });

  it("still opens mail and phone links", async () => {
    await render("[mail](mailto:hi@athas.dev) [call](tel:+15551234)");

    await click(link("mail"));
    await click(link("call"));

    expect(mocks.opened).toEqual(["mailto:hi@athas.dev", "tel:+15551234"]);
  });

  it("opens web links in the system browser", async () => {
    const longUrl = `https://example.com/${"a".repeat(80)}`;
    await render(`See [the docs](https://athas.dev/docs) or ${longUrl} now`);

    const event = await click(link("the docs"));
    expect(event.defaultPrevented).toBe(true);
    expect(mocks.opened).toEqual(["https://athas.dev/docs"]);

    const bare = container.querySelectorAll("a")[1]!;
    expect(bare.textContent).toBe(`${longUrl.slice(0, 60)}...`);
    await click(bare);
    expect(last(mocks.opened)).toBe(longUrl);
    expect(container.textContent).toContain(" now");
  });

  it("opens workspace file links in the editor at the referenced line", async () => {
    await render("Changed [src/app.ts](src/app.ts:12:4) and [readme](README.md#L3)");

    await click(link("src/app.ts"));
    await click(link("readme"));

    expect(openedFiles).toEqual([
      { path: "/repo/src/app.ts", line: 12, column: 4 },
      { path: "/repo/README.md", line: 3, column: undefined },
    ]);
    expect(mocks.opened).toEqual([]);
  });

  it("formats inline markdown", async () => {
    await render("Use `npm test`, **bold**, *em*, ~~old~~, a lone * and [brackets] then `pending");

    expect(container.querySelector("code")?.textContent).toBe("npm test");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("em");
    expect(container.querySelector("del")?.textContent).toBe("old");
    expect(container.querySelectorAll("code")[1]?.textContent).toBe("pending");
    expect(container.textContent).toContain("a lone * and [brackets] then ");
  });

  it("renders headings, rules, quotes and lists", async () => {
    await render(
      [
        "# Title",
        "####### too deep",
        "---",
        "> quoted **text**",
        ">",
        "1. first",
        "2. second",
        "- bullet",
        "+ plus",
        "after list",
        "joined line",
      ].join("\n"),
    );

    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("blockquote strong")?.textContent).toBe("text");
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
    expect([...container.querySelectorAll("ol li")].map((item) => item.textContent)).toEqual([
      "first",
      "second",
    ]);
    expect([...container.querySelectorAll("ul li")].map((item) => item.textContent)).toEqual([
      "bullet",
      "plus",
    ]);
    expect([...container.querySelectorAll("p")].map((item) => item.textContent)).toEqual([
      "####### too deep",
      "after list joined line",
    ]);
  });

  it("renders aligned tables with escaped pipes and ragged rows", async () => {
    await render(
      [
        "| Name | Score | Note |",
        "| :--- | ---: | :---: |",
        "| a \\| b | 10 |",
        "| c | 20 | ok | extra |",
      ].join("\n"),
    );

    const headers = [...container.querySelectorAll("th")];
    expect(headers.map((cell) => cell.getAttribute("align"))).toEqual(["left", "right", "center"]);
    const rows = [...container.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ["a | b", "10", ""],
      ["c", "20", "ok"],
    ]);
  });

  it("does not treat an invalid separator as a table", async () => {
    await render("| a | b |\n| -- | x |");

    expect(container.querySelector("table")).toBeNull();
  });

  it("labels code blocks with an explicit or inferred language", async () => {
    await render(
      [
        "```ts",
        "const a = 1;",
        "```",
        "",
        "```",
        "fn main() { let x = Some(1); }",
        "```",
        "",
        "```",
        "#!/bin/sh",
        "echo $HOME",
        "```",
        "",
        "```",
        "def run():",
        "    pass",
        "```",
        "",
        "```",
        "SELECT 1",
        "```",
        "",
        "```",
        "const unterminated = true;",
      ].join("\n"),
    );

    const labels = [...container.querySelectorAll('[data-ai-element="code-block"] figcaption')].map(
      (caption) => caption.querySelector("span")?.textContent,
    );
    expect(labels).toEqual(["typescript", "rust", "bash", "python", "", "typescript"]);
    expect(container.textContent).toContain("const unterminated = true;");
  });

  it("copies a code block and briefly confirms it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () =>
        root.render(<MarkdownRenderer content={"```js\nconsole.log(1)\n```"} />),
      );
      const copy = view().getByRole("button", { name: "Copy code" });

      await act(async () => {
        copy.click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.clipboard).toEqual(["console.log(1)"]);
      expect(view().getByRole("button", { name: "Copied" })).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(1600);
      });
      expect(view().getByRole("button", { name: "Copy code" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a legacy error block between the surrounding text", async () => {
    await render(
      "Partly done\n\n[ERROR_BLOCK]\ntitle: Rate limited\nmessage: Too many requests\n[/ERROR_BLOCK]\n\nAfter",
    );

    expect(container.textContent).toContain("Partly done");
    expect(container.textContent).toContain("Rate limited");
    expect(container.textContent).toContain("Too many requests");
    expect(container.textContent?.trim().endsWith("After")).toBe(true);
  });

  it("marks a reply that is still streaming", async () => {
    await render("partial", { isStreaming: true });

    expect(container.querySelector("[data-streaming]")).not.toBeNull();
  });
});
