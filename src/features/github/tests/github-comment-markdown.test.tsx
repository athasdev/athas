// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import GitHubMarkdown from "../components/github-markdown";

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { use: { actions: () => ({}) } },
}));
vi.mock("@/features/editor/markdown/code-highlight", () => ({
  highlightMarkdownCodeBlocks: async (html: string) => html,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
async function render(content: string) {
  await act(async () =>
    root.render(
      <GitHubMarkdown
        content={content}
        repositoryUrl="https://github.com/athasdev/athas"
        className="github-markdown-pr"
      />,
    ),
  );
  await act(async () => vi.runAllTimersAsync());
}

describe("GitHub comment Markdown", () => {
  it("hides bot metadata and renders reference links, table images, and deliberate line breaks", async () => {
    await render(`[vc]: #deployment_metadata

| Project | Deployment |
| --- | --- |
| <img src="https://example.com/project_icon.png" width="16" height="16" alt="Project" /> [docs][preview] | Building<br>Ready |

[preview]: https://example.com/deploy?project=docs_site "Deployment"

[![Deploy](https://example.com/button.svg)](https://example.com/new)
`);
    expect(container.textContent).not.toContain("[vc]");
    expect(container.textContent).not.toContain("deployment_metadata");
    expect(
      container.querySelector('a[href="https://example.com/deploy?project=docs_site"]')
        ?.textContent,
    ).toBe("docs");
    expect(container.querySelector("td img")?.getAttribute("src")).toBe(
      "https://example.com/project_icon.png",
    );
    expect(container.querySelector("td img")?.getAttribute("width")).toBe("16");
    expect(container.querySelector("td br")).not.toBeNull();
    expect(
      container.querySelector('a[href="https://example.com/new"] img')?.getAttribute("src"),
    ).toBe("https://example.com/button.svg");
  });

  it("keeps task text, inline code, and disclosures together", async () => {
    await render(
      '<details>\n<summary>PR Summary</summary>\n\n- [ ] Hoist the lookup to a const (e.g. `const reconnect = renderAction?.("reconnect")`) or extract one shared helper.\n\n</details>',
    );
    const item = container.querySelector("details .task-list-item")!;
    expect(item.textContent).toContain('const reconnect = renderAction?.("reconnect")');
    expect(item.textContent).toContain(") or extract one shared helper.");
    expect(item.querySelector("code")?.textContent).toBe(
      'const reconnect = renderAction?.("reconnect")',
    );
    expect(item.querySelector("input")?.disabled).toBe(true);
    expect(container.querySelector("summary")?.textContent).toBe("PR Summary");
  });

  it("preserves reference destinations on the next line without autolinking them", async () => {
    await render(
      "[Deployment][preview]\n\n[preview]:\n  https://example.com/deploy?project=docs_site",
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/deploy?project=docs_site",
    );
    expect(container.textContent).toBe("Deployment");
  });

  it("preserves code literals and sanitizes reference destinations", async () => {
    await render(
      "`<img src=x onerror=alert(1)>`\n\n[unsafe][link]\n\n[link]: javascript:alert(1)\n\n<script>alert(1)</script>",
    );
    expect(container.querySelector("code")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(container.querySelector("script, img, [onerror], a[href]")).toBeNull();
  });

  it("keeps a linked badge usable when its image cannot load", async () => {
    await render(
      "[![Open deployment](https://example.com/unavailable.svg)](https://example.com/deployment)",
    );
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")?.textContent).toBe("Open deployment");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/deployment",
    );
  });
});
