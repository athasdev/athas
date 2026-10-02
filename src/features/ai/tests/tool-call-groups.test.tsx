// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  buildToolActivity,
  describeToolActivity,
  findLatestEdit,
  summarizeToolActivity,
} from "@/features/ai/lib/tool-call-groups";
import { ToolCallList } from "@/features/ai/components/messages/tool-call-display";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/extensions/ui/components/extension-diff-preview", () => ({
  ExtensionDiffPreview: ({ lines, caption }: { lines: unknown[]; caption?: boolean }) => (
    <div data-testid="diff" data-rows={lines.length} data-caption={String(caption)} />
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

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
const run = (command: string, overrides: Partial<ToolCall> = {}) =>
  call({ id: `run-${command}`, kind: "execute", input: { command }, ...overrides });
const thought = (text: string) =>
  call({ id: `thought-${text}`, name: "Thought", kind: "think", output: text });

describe("tool activity grouping", () => {
  it("keeps a lone call on its own row and a lone thought as a thought", () => {
    expect(buildToolActivity([read("a.ts")]).map((item) => item.type)).toEqual(["call"]);
    expect(buildToolActivity([thought("hmm")]).map((item) => item.type)).toEqual(["thought"]);
    expect(buildToolActivity([])).toEqual([]);
  });

  it("folds two or more calls into one summary in the order the agent worked", () => {
    const items = buildToolActivity([
      read("a.ts"),
      read("b.ts"),
      read("a.ts"),
      search("todo"),
      edit("e1"),
      run("bun test"),
      thought("next"),
    ]);
    expect(items).toHaveLength(1);
    const [group] = items;
    expect(group?.type).toBe("group");
    if (group?.type !== "group") return;
    expect(group.toolCalls).toHaveLength(7);
    expect(describeToolActivity(group.summary)).toBe(
      "Read 2 files, searched once, edited 1 file, ran 1 command",
    );
    expect(group.summary).toMatchObject({ failed: 0, running: null, additions: 1, deletions: 0 });
  });

  it("counts distinct files edited, including every file of a multi-file diff", () => {
    const multi = call({
      id: "m",
      kind: "edit",
      output: [
        { type: "diff", path: "/repo/b.ts", oldText: "", newText: "b" },
        { type: "diff", path: "/repo/c.ts", oldText: "", newText: "c" },
      ],
    });
    const summary = summarizeToolActivity([edit("e1"), edit("e2"), multi]);
    expect(describeToolActivity(summary)).toBe("Edited 3 files");
  });

  it("counts failures and names the step still running", () => {
    const failed = run("bun test", { status: "failed", error: "exit 1" });
    const running = run("bun build", { status: "in_progress" });
    const summary = summarizeToolActivity([read("a.ts"), failed, running]);
    expect(summary.failed).toBe(1);
    expect(summary.running).toBe(running);
    expect(summary.durationMs).toBeNull();
  });

  it("spans from the first start to the last finish once every step recorded its time", () => {
    const summary = summarizeToolActivity([
      { ...read("a.ts"), timestamp: at(2), durationMs: 500 },
      run("bun test", { timestamp: at(10), durationMs: 4000 }),
    ]);
    expect(summary.startedAt).toBe(at(2).getTime());
    expect(summary.durationMs).toBe(12_000);
  });

  it("gives no duration when a step never recorded one", () => {
    const summary = summarizeToolActivity([
      { ...read("a.ts"), timestamp: at(2), durationMs: 500 },
      { ...run("bun test"), timestamp: at(4) },
    ]);
    expect(summary.durationMs).toBeNull();
  });

  it("leaves thoughts out of counts and timing", () => {
    const summary = summarizeToolActivity([
      thought("first"),
      { ...read("a.ts"), timestamp: at(1), durationMs: 2000 },
    ]);
    expect(describeToolActivity(summary)).toBe("Read 1 file");
    expect(summary.durationMs).toBe(2000);
    expect(describeToolActivity(summarizeToolActivity([thought("a"), thought("b")]))).toBe(
      "Thought",
    );
  });

  it("describes searches, commands and tools in plain words", () => {
    expect(
      describeToolActivity({
        steps: [
          { kind: "search", count: 2 },
          { kind: "search", count: 5 },
          { kind: "execute", count: 3 },
          { kind: "other", count: 1 },
        ],
      }),
    ).toBe("Searched twice, searched 5 times, ran 3 commands, used 1 tool");
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
  it("collapses a finished turn to its summary and expands to the steps", async () => {
    await act(async () =>
      root.render(
        <ToolCallList
          toolCalls={[
            { ...read("a.ts"), timestamp: at(0), durationMs: 1000 },
            { ...search("x"), timestamp: at(1), durationMs: 11_000 },
          ]}
        />,
      ),
    );
    const summary = container.querySelector("button")!;
    expect(summary.textContent).toContain("Worked for 12s");
    expect(summary.textContent).toContain("Read 1 file, searched once");
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll('[data-ai-element="tool-call"]')).toHaveLength(0);
    await act(async () => summary.click());
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll('[data-ai-element="tool-call"]')).toHaveLength(2);
  });

  it("opens a turn with a failed step and shows its error", async () => {
    await act(async () =>
      root.render(
        <ToolCallList
          toolCalls={[read("a.ts"), run("bun test", { status: "failed", error: "exit code 1" })]}
        />,
      ),
    );
    const summary = container.querySelector("button")!;
    expect(summary.textContent).toContain("1 failed");
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    const failed = container.querySelector('[data-phase="failed"]')!;
    expect(failed.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
    expect(failed.textContent).toContain("exit code 1");
  });

  it("names the running step while the turn works", async () => {
    await act(async () =>
      root.render(
        <ToolCallList
          isStreaming
          toolCalls={[read("a.ts"), run("bun build", { status: "in_progress" })]}
        />,
      ),
    );
    const summary = container.querySelector('[data-ai-element="tool-call-group"] button')!;
    expect(summary.getAttribute("role")).toBe("status");
    expect(summary.textContent).toContain("Working");
    expect(summary.textContent).toContain("Running bun build");
  });

  it("reads a lone thought as a disclosure", async () => {
    await act(async () =>
      root.render(
        <ToolCallList toolCalls={[{ ...thought("Check the tests"), durationMs: 3000 }]} />,
      ),
    );
    const toggle = container.querySelector('[data-ai-element="thought"] button')!;
    expect(toggle.textContent).toBe("Thought for 3s");
    await act(async () => (toggle as HTMLButtonElement).click());
    expect(container.textContent).toContain("Check the tests");
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
    // The tool row already names the one file it edited, so the diff does not repeat it.
    expect(diffs[0]!.getAttribute("data-caption")).toBe("false");

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
