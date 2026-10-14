import { describe, expect, it } from "vite-plus/test";
import {
  canFloatSessionPills,
  getSessionPills,
  type SessionPillSignals,
} from "../services/session-pills";

const quiet: SessionPillSignals = {
  panelOpen: false,
  changes: { files: 0, additions: 0, deletions: 0 },
  liveServer: null,
  terminalFailed: false,
  agentCommandFailed: false,
  runningCommand: null,
  plan: null,
};

const ids = (signals: Partial<SessionPillSignals>) =>
  getSessionPills({ ...quiet, ...signals }).map((pill) => `${pill.id}:${pill.tab}`);

describe("session signal pills", () => {
  it("shows nothing for a quiet session", () => {
    expect(getSessionPills(quiet)).toEqual([]);
  });

  it("shows each pill only while its signal exists, in tab order", () => {
    expect(
      ids({
        plan: { done: 3, total: 7 },
        runningCommand: "bun test",
        liveServer: "http://localhost:5173/",
        changes: { files: 2, additions: 12, deletions: 3 },
      }),
    ).toEqual(["changes:changes", "browser:browser", "terminal:activity", "plan:plan"]);
  });

  it("hides every pill while the panel is open, since its tabs carry the marks", () => {
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

  it("opens Terminal for its own failures and Activity for the agent's commands", () => {
    expect(ids({ terminalFailed: true, agentCommandFailed: true })).toEqual(["terminal:terminal"]);
    expect(ids({ agentCommandFailed: true, runningCommand: "bun dev" })).toEqual([
      "terminal:activity",
    ]);
    const [running] = getSessionPills({ ...quiet, runningCommand: "bun dev" });
    expect(running).toMatchObject({ state: "running", command: "bun dev" });
  });

  it("floats the pills only beside a chat column with room to spare", () => {
    expect(canFloatSessionPills(1600, 16)).toBe(true);
    expect(canFloatSessionPills(1216, 16)).toBe(true);
    expect(canFloatSessionPills(1100, 16)).toBe(false);
    expect(canFloatSessionPills(600, 16)).toBe(false);
  });
});
