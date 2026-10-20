import { describe, expect, it } from "vite-plus/test";
import {
  getPullRequestNumber,
  getSessionStatus,
  readPullRequestState,
  type SessionStatusSignals,
} from "../services/session-status";

const quiet: SessionStatusSignals = {
  working: false,
  attention: null,
  unreviewedEdits: 0,
  cloudRun: null,
};
const status = (signals: Partial<SessionStatusSignals>) =>
  getSessionStatus({ ...quiet, ...signals });

describe("session status", () => {
  it("puts a session waiting on the user before anything else", () => {
    expect(status({ attention: "permission", working: true })).toBe("needs-input");
  });

  it("shows a turn or a cloud run at work", () => {
    expect(status({ working: true })).toBe("running");
    expect(status({ cloudRun: { status: "queued", prUrl: null } })).toBe("running");
  });

  it("marks a failed cloud run", () => {
    expect(status({ cloudRun: { status: "failed", prUrl: null } })).toBe("failed");
  });

  it("reads a cloud run's pull request as opened or merged", () => {
    const run = { status: "succeeded" as const, prUrl: "https://github.com/a/b/pull/1" };
    expect(status({ cloudRun: run })).toBe("pr");
    expect(status({ cloudRun: run, pullRequest: "merged" })).toBe("merged");
    expect(status({ cloudRun: { status: "succeeded", prUrl: null } })).toBe("idle");
  });

  it("reads the pull request of a local session's branch", () => {
    expect(status({ pullRequest: "open" })).toBe("pr");
    expect(status({ pullRequest: "merged", unreviewedEdits: 3 })).toBe("merged");
    expect(status({ pullRequest: "open", unreviewedEdits: 3 })).toBe("review");
    expect(status({ pullRequest: "closed" })).toBe("idle");
    expect(status({ pullRequest: "merged", working: true })).toBe("running");
  });

  it("reads pull request numbers and states from GitHub", () => {
    expect(getPullRequestNumber("https://github.com/a/b/pull/42")).toBe(42);
    expect(getPullRequestNumber("https://github.com/a/b/pull/42/files")).toBe(42);
    expect(getPullRequestNumber("https://github.com/a/b/issues/42")).toBeNull();
    expect(getPullRequestNumber(null)).toBeNull();
    expect(readPullRequestState({ state: "MERGED" })).toBe("merged");
    expect(readPullRequestState({ state: "closed", mergedAt: "2026-10-01" })).toBe("merged");
    expect(readPullRequestState({ state: "OPEN" })).toBe("open");
    expect(readPullRequestState({ state: "CLOSED", mergedAt: null })).toBe("closed");
  });

  it("offers a review while edits are left unreviewed, else nothing", () => {
    expect(status({ unreviewedEdits: 2 })).toBe("review");
    expect(status({})).toBe("idle");
  });
});
