// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CodeHighlightSegment } from "@/features/editor/markdown/code-highlight";
import { useCodeHighlightSegments } from "@/features/editor/markdown/highlighted-code";

const highlight = vi.hoisted(() =>
  vi.fn(async (code: string): Promise<CodeHighlightSegment[]> => [
    { start: 0, end: code.length, className: `token-${code.length}` },
  ]),
);
vi.mock("@/features/editor/markdown/code-highlight", () => ({
  getCodeHighlightSegments: highlight,
}));

let seen: CodeHighlightSegment[][] = [];
function Probe({ code }: { code: string }) {
  seen.push(useCodeHighlightSegments(code, "typescript"));
  return null;
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  highlight.mockClear();
  seen = [];
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

const latest = () => seen[seen.length - 1]!;

describe("streamed code highlighting", () => {
  it("keeps earlier colours while the code grows", async () => {
    await act(async () => root.render(<Probe code={"const a = 1;\n"} />));
    await act(async () => vi.runAllTimersAsync());
    expect(latest()[0]?.className).toBe("token-13");

    await act(async () => root.render(<Probe code={"const a = 1;\ncon"} />));
    expect(latest()[0]?.className).toBe("token-13");
    // Only the whole first line is highlighted until the partial line settles.
    expect(highlight).toHaveBeenLastCalledWith("const a = 1;\n", "typescript");

    await act(async () => vi.runAllTimersAsync());
    expect(highlight).toHaveBeenLastCalledWith("const a = 1;\ncon", "typescript");
    expect(latest()[0]?.className).toBe("token-16");
  });

  it("drops colours that no longer match the code", async () => {
    await act(async () => root.render(<Probe code={"let x = 1;\n"} />));
    await act(async () => vi.runAllTimersAsync());
    await act(async () => root.render(<Probe code={"other\n"} />));
    expect(latest()).toEqual([]);
  });
});
