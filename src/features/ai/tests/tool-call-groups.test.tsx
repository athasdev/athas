// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  describeExploration,
  findLatestEdit,
  groupToolCalls,
} from "@/features/ai/lib/tool-call-groups";
import { ToolCallList } from "@/features/ai/components/messages/tool-call-display";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/extensions/ui/components/extension-view-renderer", () => ({
  ExtensionViewRenderer: ({ node }: { node: { lines: unknown[] } }) => (
    <div data-testid="diff" data-rows={node.lines.length} />
  ),
}));

const call = (overrides: Partial<ToolCall>): ToolCall => ({
  name: "tool",
  input: {},
  timestamp: new Date(0),
  status: "completed",
  ...overrides,
});
const read = (path: string) => call({ id: `read-${path}`, kind: "read", input: { path } });
const search = (query: string) => call({ id: `search-${query}`, kind: "search", input: { query } });
const edit = (id: string, lines = 1) =>
  call({
    id,
    kind: "edit",
    input: { path: "/repo/a.ts" },
    output: [
      {
        type: "diff",
        path: "/repo/a.ts",
        oldText: "",
        newText: Array.from({ length: lines }, (_, index) => `line ${index}`).join("\n"),
      },
    ],
  });

describe("tool call grouping", () => {
  it("folds consecutive reads and searches into one exploration", () => {
    const items = groupToolCalls([
      read("a.ts"),
      read("b.ts"),
      read("a.ts"),
      search("todo"),
      edit("e1"),
      read("c.ts"),
    ]);
    expect(items.map((item) => item.type)).toEqual(["exploration", "call", "call"]);
    expect(items[0]).toMatchObject({ files: 2, searches: 1, isRunning: false });
    expect(describeExploration(items[0] as never)).toBe("Explored 2 files, 1 search");
  });

  it("keeps a failed read on its own row", () => {
    const failed = call({ id: "bad", kind: "read", status: "failed", error: "missing" });
    const items = groupToolCalls([read("a.ts"), failed, read("b.ts")]);
    expect(items.map((item) => item.type)).toEqual(["call", "call", "call"]);
  });

  it("describes an exploration that is still running", () => {
    const items = groupToolCalls([read("a.ts"), call({ kind: "search", status: "in_progress" })]);
    expect(describeExploration(items[0] as never)).toBe("Exploring 1 file, 1 search");
  });

  it("finds the newest call with a recorded diff", () => {
    const latest = edit("e2");
    expect(findLatestEdit([edit("e1"), latest, read("a.ts")])).toBe(latest);
    expect(findLatestEdit([read("a.ts")])).toBeNull();
  });
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("tool call list", () => {
  it("expands an exploration to its calls", async () => {
    await act(async () => root.render(<ToolCallList toolCalls={[read("a.ts"), search("x")]} />));
    const summary = container.querySelector("button")!;
    expect(summary.textContent).toContain("Explored 1 file, 1 search");
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    await act(async () => summary.click());
    expect(container.textContent).toContain("a.ts");
  });

  it("opens only the latest edit and caps its diff", async () => {
    const first = edit("e1");
    const latest = edit("e2", 40);
    await act(async () =>
      root.render(<ToolCallList toolCalls={[first, latest]} latestEdit={latest} />),
    );
    const rows = container.querySelectorAll('[data-ai-element="tool-call"]');
    expect(rows[0]!.querySelector('[aria-hidden="false"]')).toBeNull();
    const diffs = container.querySelectorAll('[data-testid="diff"]');
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.getAttribute("data-rows")).toBe("16");

    const expand = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("Expand diff"),
    )!;
    await act(async () => expand.click());
    expect(Number(container.querySelector('[data-testid="diff"]')!.getAttribute("data-rows"))).toBe(
      41,
    );
  });

  it("offers Open diff only for a call that recorded one", async () => {
    await act(async () =>
      root.render(
        <ToolCallList
          toolCalls={[call({ id: "n", kind: "edit", input: { path: "/repo/a.ts" } })]}
        />,
      ),
    );
    expect(container.querySelector('[aria-label="Open diff"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open file"]')).not.toBeNull();
  });
});
