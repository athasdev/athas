import { describe, expect, it } from "vite-plus/test";
import {
  BOX_COLUMN_MIN_REM,
  getSessionAsideLayout,
  getSessionRunningItems,
  getSessionToolTabs,
  getVisibleSessionBoxes,
  SHORT_COMMAND_MS,
  type SessionRunningSignals,
  TOOL_SPLIT_MIN_REM,
} from "../services/session-boxes";

const NOW = 1_000_000;
const quiet: SessionRunningSignals = {
  liveServer: null,
  terminalFailed: false,
  runningCommand: null,
  now: NOW,
};
const running = (signals: Partial<SessionRunningSignals>) =>
  getSessionRunningItems({ ...quiet, ...signals });
const command = (text: string, ago = 0) => ({ command: text, startedAt: NOW - ago });

describe("session boxes", () => {
  it("shows no boxes before the session starts, unless they have something to say", () => {
    expect(
      getVisibleSessionBoxes({
        started: false,
        hasContextUsage: false,
        runningItems: 0,
        hasPlan: false,
        connectors: 0,
      }),
    ).toEqual([]);
    expect(
      getVisibleSessionBoxes({
        started: false,
        hasContextUsage: false,
        runningItems: 0,
        hasPlan: false,
        connectors: 1,
      }),
    ).toEqual(["connectors"]);
  });

  it("shows Environment and Changes once started, and the rest once they have something to say", () => {
    expect(
      getVisibleSessionBoxes({
        started: true,
        hasContextUsage: false,
        runningItems: 0,
        hasPlan: false,
        connectors: 0,
      }),
    ).toEqual(["environment", "changes"]);
    expect(
      getVisibleSessionBoxes({
        started: true,
        hasContextUsage: true,
        runningItems: 1,
        hasPlan: true,
        connectors: 2,
      }),
    ).toEqual(["environment", "context", "changes", "running", "plan", "connectors"]);
  });

  it("shows a cloud session's sandbox and spend instead of local context and servers", () => {
    const local = {
      started: true,
      hasContextUsage: true,
      runningItems: 1,
      hasPlan: true,
      connectors: 2,
    };
    expect(getVisibleSessionBoxes({ ...local, cloud: { running: true, hasRun: true } })).toEqual([
      "environment",
      "changes",
      "running",
      "cost",
      "plan",
    ]);
    expect(getVisibleSessionBoxes({ ...local, cloud: { running: false, hasRun: true } })).toEqual([
      "environment",
      "changes",
      "cost",
      "plan",
    ]);
    expect(
      getVisibleSessionBoxes({
        ...local,
        hasPlan: false,
        cloud: { running: false, hasRun: false },
      }),
    ).toEqual(["environment", "changes"]);
  });

  it("offers Plan as a tool only while the session has one", () => {
    expect(getSessionToolTabs(false)).toEqual(["changes", "browser", "terminal"]);
    expect(getSessionToolTabs(true)).toEqual(["changes", "browser", "terminal", "plan"]);
  });
});

describe("running items", () => {
  it("has nothing for a quiet session", () => {
    expect(running({})).toEqual([]);
  });

  it("joins a dev server and the command running it into one row", () => {
    expect(
      running({ liveServer: "http://localhost:5173/", runningCommand: command("bun dev") }),
    ).toEqual([{ kind: "server", url: "http://localhost:5173/", command: "bun dev" }]);
  });

  it("shows a short command as running until it keeps going, then as live", () => {
    expect(running({ runningCommand: command("bun test") })).toEqual([
      { kind: "command", state: "running", command: "bun test" },
    ]);
    expect(running({ runningCommand: command("bun test", SHORT_COMMAND_MS) })).toEqual([
      { kind: "command", state: "live", command: "bun test" },
    ]);
  });

  it("keeps a waited-on command beside a server it did not start", () => {
    expect(
      running({ liveServer: "http://localhost:3000/", runningCommand: command("bun test") }).map(
        (item) => item.kind,
      ),
    ).toEqual(["server", "command"]);
  });

  it("adds a failed terminal command", () => {
    expect(running({ terminalFailed: true })).toEqual([{ kind: "failed" }]);
  });
});

describe("session aside layout", () => {
  const remPx = 16;
  const wide = BOX_COLUMN_MIN_REM * remPx;
  const layout = (overrides: Partial<Parameters<typeof getSessionAsideLayout>[0]>) =>
    getSessionAsideLayout({
      width: wide,
      remPx,
      toolOpen: false,
      fullscreen: false,
      boxesHidden: false,
      ...overrides,
    });

  it("stacks the boxes beside the chat when there is room, and folds them into a rail when not", () => {
    expect(layout({})).toEqual({ boxes: "column", tool: "none" });
    expect(layout({ width: wide - 1 })).toEqual({ boxes: "rail", tool: "none" });
  });

  it("folds the column into its rail while a tool is open, and unfolds it once it closes", () => {
    expect(layout({ toolOpen: true })).toEqual({ boxes: "rail", tool: "split" });
    expect(layout({ toolOpen: false })).toEqual({ boxes: "column", tool: "none" });
  });

  it("lets the tool cover the chat in fullscreen or a narrow session, keeping the rail", () => {
    expect(layout({ toolOpen: true, fullscreen: true })).toEqual({ boxes: "rail", tool: "cover" });
    expect(layout({ toolOpen: true, width: TOOL_SPLIT_MIN_REM * remPx - 1 })).toEqual({
      boxes: "rail",
      tool: "cover",
    });
    expect(layout({ toolOpen: true, width: TOOL_SPLIT_MIN_REM * remPx })).toEqual({
      boxes: "rail",
      tool: "split",
    });
  });

  it("scales the thresholds with the UI font size", () => {
    expect(layout({ remPx: 20, width: wide })).toEqual({ boxes: "rail", tool: "none" });
  });

  it("shows no boxes once the user hides them, while tools still open", () => {
    expect(layout({ boxesHidden: true })).toEqual({ boxes: "hidden", tool: "none" });
    expect(layout({ boxesHidden: true, toolOpen: true })).toEqual({
      boxes: "hidden",
      tool: "split",
    });
  });
});
