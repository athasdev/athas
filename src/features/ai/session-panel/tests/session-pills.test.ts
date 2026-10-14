import { describe, expect, it } from "vite-plus/test";
import {
  canFloatSessionPills,
  getSessionPills,
  SHORT_COMMAND_MS,
  type SessionPillSignals,
} from "../services/session-pills";

const NOW = 1_000_000;
const quiet: SessionPillSignals = {
  panelOpen: false,
  changes: { files: 0, additions: 0, deletions: 0 },
  liveServer: null,
  terminalFailed: false,
  runningCommand: null,
  plan: null,
  now: NOW,
};

const pills = (signals: Partial<SessionPillSignals>) => getSessionPills({ ...quiet, ...signals });
const ids = (signals: Partial<SessionPillSignals>) =>
  pills(signals).map((pill) => `${pill.id}:${pill.tab}`);
const running = (command: string, ago = 0) => ({ command, startedAt: NOW - ago });

describe("session signal pills", () => {
  it("shows nothing for a quiet session", () => {
    expect(getSessionPills(quiet)).toEqual([]);
  });

  it("shows each pill only while its signal exists, in tool order", () => {
    expect(
      ids({
        plan: { done: 3, total: 7 },
        runningCommand: running("bun test"),
        liveServer: "http://localhost:5173/",
        changes: { files: 2, additions: 12, deletions: 3 },
      }),
    ).toEqual(["changes:changes", "browser:browser", "terminal:terminal", "plan:plan"]);
  });

  it("hides every pill while the card is expanded, since its switcher carries the marks", () => {
    expect(
      ids({
        panelOpen: true,
        changes: { files: 1, additions: 1, deletions: 0 },
        liveServer: "http://localhost:5173/",
        terminalFailed: true,
        plan: { done: 1, total: 2 },
      }),
    ).toEqual([]);
  });

  it("leaves out changes that add and remove nothing and plans without entries", () => {
    expect(ids({ changes: { files: 1, additions: 0, deletions: 0 } })).toEqual([]);
    expect(ids({ plan: { done: 0, total: 0 } })).toEqual([]);
  });

  it("spins only for a short command in its first moments", () => {
    expect(pills({ runningCommand: running("bun test", 1000) })[0]).toMatchObject({
      state: "running",
    });
    expect(pills({ runningCommand: running("bun test", SHORT_COMMAND_MS) })[0]).toMatchObject({
      state: "live",
    });
    expect(pills({ runningCommand: running("npm run dev") })[0]).toMatchObject({ state: "live" });
  });

  it("merges a live process into the pill of the server it runs", () => {
    const merged = pills({
      runningCommand: running("mise exec node@24 -- ./node_modules/.bin/vp run dev"),
      liveServer: "http://localhost:3000/",
    });
    expect(merged).toEqual([
      {
        id: "browser",
        tab: "browser",
        url: "http://localhost:3000/",
        command: "mise exec node@24 -- ./node_modules/.bin/vp run dev",
      },
    ]);
  });

  it("marks only a failure in the session terminal, which wins over a running command", () => {
    expect(pills({ terminalFailed: true, runningCommand: running("bun dev") })).toEqual([
      { id: "terminal", tab: "terminal", state: "failed", command: null },
    ]);
  });

  it("floats the pills only beside a chat column with room to spare", () => {
    expect(canFloatSessionPills(1600, 16)).toBe(true);
    expect(canFloatSessionPills(1376, 16)).toBe(true);
    expect(canFloatSessionPills(1300, 16)).toBe(false);
    expect(canFloatSessionPills(1100, 16)).toBe(false);
    expect(canFloatSessionPills(600, 16)).toBe(false);
  });
});
