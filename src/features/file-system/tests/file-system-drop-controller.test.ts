import { describe, expect, it } from "vite-plus/test";
import {
  dispatchDroppedPathsToTerminal,
  handleDroppedExternalPaths,
  handleExternalFileDropPayload,
  getExternalFileDropRoute,
  isExternalFileDragTypeList,
  resolveDropClientPoint,
  TERMINAL_FILE_DROP_EVENT,
  type TerminalFileDropDetail,
} from "../utils/file-system-drop-controller";

describe("file system drop controller", () => {
  it("parses, dedupes, and forwards dropped external paths", async () => {
    const dropped: string[][] = [];

    await handleDroppedExternalPaths(
      [
        "file:///Users/test/project/file.ts",
        "/Users/test/project/file.ts",
        "/Users/test/project/other.ts\n# ignored",
      ],
      async (paths) => {
        dropped.push(paths);
      },
    );

    expect(dropped).toEqual([["/Users/test/project/file.ts", "/Users/test/project/other.ts"]]);
  });

  it("does not call onDrop when the dropped payload contains no supported paths", async () => {
    let called = false;

    await handleDroppedExternalPaths(["https://athas.dev", "relative/path.ts"], () => {
      called = true;
    });

    expect(called).toBe(false);
  });

  it("keeps drag state in sync for enter, leave, and drop events", async () => {
    const states: boolean[] = [];
    const opened: string[][] = [];

    await handleExternalFileDropPayload(
      { type: "enter" },
      {
        onDrop: (paths) => {
          opened.push(paths);
        },
        setDraggingOver: (value) => states.push(value),
      },
    );
    await handleExternalFileDropPayload(
      { type: "drop", paths: ["/Users/test/project"] },
      {
        onDrop: (paths) => {
          opened.push(paths);
        },
        setDraggingOver: (value) => states.push(value),
      },
    );
    await handleExternalFileDropPayload(
      { type: "leave" },
      {
        onDrop: (paths) => {
          opened.push(paths);
        },
        setDraggingOver: (value) => states.push(value),
      },
    );

    expect(opened).toEqual([["/Users/test/project"]]);
    expect(states).toEqual([true, false, false]);
  });

  it("reports drop handler errors without leaving drag state stuck", async () => {
    const errors: unknown[] = [];
    const states: boolean[] = [];

    await handleExternalFileDropPayload(
      { type: "drop", paths: ["/Users/test/project"] },
      {
        onDrop: async () => {
          throw new Error("open failed");
        },
        onError: (error) => errors.push(error),
        setDraggingOver: (value) => states.push(value),
      },
    );

    expect(errors).toHaveLength(1);
    expect(states).toEqual([false]);
  });

  it("detects OS file drags from drag event type lists", () => {
    expect(isExternalFileDragTypeList(["Files", "text/plain"])).toBe(true);
    expect(isExternalFileDragTypeList(["text/plain"])).toBe(false);
    expect(isExternalFileDragTypeList(null)).toBe(false);
  });

  it("routes external file drops away from the global project opener for local surfaces", () => {
    const target = (matchedSelector: string | null) =>
      ({
        closest: (selector: string) =>
          matchedSelector && selector.includes(matchedSelector) ? ({} as Element) : null,
      }) as Element;

    expect(getExternalFileDropRoute(target("[data-terminal-drop-target]"))).toBe("terminal");
    expect(getExternalFileDropRoute(target("[data-pane-container]"))).toBe("local");
    expect(getExternalFileDropRoute(target("[data-pane-container]"), true)).toBe("global");
    expect(getExternalFileDropRoute(target("[data-external-file-drop-scope]"))).toBe("local");
    expect(getExternalFileDropRoute(target("[data-external-file-drop-scope]"), true)).toBe("local");
    expect(getExternalFileDropRoute(target("[data-bottom-pane-drop-target]"), true)).toBe("local");
    expect(getExternalFileDropRoute(target("[data-ai-context-drop-target]"), true)).toBe("local");
    expect(getExternalFileDropRoute(target(null))).toBe("global");
    expect(getExternalFileDropRoute(null)).toBe("global");
  });

  it("resolves Tauri physical drop positions against logical DOM coordinates", () => {
    const terminalElement = {} as Element;
    const points: Array<[number, number]> = [];

    const resolved = resolveDropClientPoint({ x: 240, y: 120 }, 2, (x, y) => {
      points.push([x, y]);
      return terminalElement;
    });

    expect(points).toEqual([[120, 60]]);
    expect(resolved).toEqual({ point: { x: 120, y: 60 }, element: terminalElement });
  });

  it("falls back to raw drop coordinates when the logical point is outside the DOM", () => {
    const rawElement = {} as Element;
    const points: Array<[number, number]> = [];

    const resolved = resolveDropClientPoint({ x: 240, y: 120 }, 2, (x, y) => {
      points.push([x, y]);
      return x === 240 && y === 120 ? rawElement : null;
    });

    expect(points).toEqual([
      [120, 60],
      [240, 120],
    ]);
    expect(resolved).toEqual({ point: { x: 240, y: 120 }, element: rawElement });
  });

  it("delivers parsed native paths to the targeted terminal surface", () => {
    const events: Event[] = [];
    const terminalTarget = {
      dispatchEvent: (event: Event) => {
        events.push(event);
        return true;
      },
    } as Element;
    const target = {
      closest: (selector: string) =>
        selector === "[data-terminal-drop-target]" ? terminalTarget : null,
    } as Element;

    expect(
      dispatchDroppedPathsToTerminal(target, [
        "file:///Users/test/My%20Image.png",
        "/Users/test/My Image.png",
      ]),
    ).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(TERMINAL_FILE_DROP_EVENT);
    expect((events[0] as CustomEvent<TerminalFileDropDetail>).detail).toEqual({
      paths: ["/Users/test/My Image.png"],
    });
  });
});
