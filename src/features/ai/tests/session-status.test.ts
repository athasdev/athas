// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  getSessionStatus,
  needsUserAttention,
  type SessionStatusSignals,
} from "../services/session-status";
import { useSessionInboxStore } from "../stores/session-inbox.store";

const quiet: SessionStatusSignals = {
  working: false,
  attention: null,
  outcome: null,
  unreviewedEdits: 0,
  cloudRun: null,
};
const status = (signals: Partial<SessionStatusSignals>) =>
  getSessionStatus({ ...quiet, ...signals });
const outcome = (value: "complete" | "error") => ({ outcome: value, unread: true, at: 1 });

describe("session status", () => {
  it("puts a session waiting on the user before anything else", () => {
    expect(status({ attention: "permission", working: true })).toBe("needs-input");
  });

  it("shows a turn or a cloud run at work", () => {
    expect(status({ working: true, outcome: outcome("error") })).toBe("running");
    expect(status({ cloudRun: { status: "queued", prUrl: null } })).toBe("running");
  });

  it("marks a failed turn or cloud run", () => {
    expect(status({ outcome: outcome("error") })).toBe("failed");
    expect(status({ cloudRun: { status: "failed", prUrl: null } })).toBe("failed");
  });

  it("reads a cloud run's pull request as opened or merged", () => {
    const run = { status: "succeeded" as const, prUrl: "https://github.com/a/b/pull/1" };
    expect(status({ cloudRun: run })).toBe("pr");
    expect(status({ cloudRun: run, prMerged: true })).toBe("merged");
    expect(status({ cloudRun: { status: "succeeded", prUrl: null } })).toBe("idle");
  });

  it("offers a review while edits are left unreviewed, else nothing", () => {
    expect(status({ unreviewedEdits: 2, outcome: outcome("complete") })).toBe("review");
    expect(status({ outcome: outcome("complete") })).toBe("idle");
  });

  it("sends waiting sessions and unseen endings to the Inbox, not running ones", () => {
    expect(needsUserAttention("needs-input", false)).toBe(true);
    expect(needsUserAttention("idle", true)).toBe(true);
    expect(needsUserAttention("failed", true)).toBe(true);
    expect(needsUserAttention("running", true)).toBe(false);
    expect(needsUserAttention("review", false)).toBe(false);
  });
});

describe("session inbox store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionInboxStore.setState({ outcomes: {} });
  });

  it("keeps a turn that ended out of sight unread until the session shows", () => {
    const { recordOutcome, markRead } = useSessionInboxStore.getState().actions;
    recordOutcome("a", "complete", false);
    recordOutcome("b", "error", true);
    expect(useSessionInboxStore.getState().outcomes.a).toMatchObject({
      outcome: "complete",
      unread: true,
    });
    expect(useSessionInboxStore.getState().outcomes.b.unread).toBe(false);
    markRead("a");
    expect(useSessionInboxStore.getState().outcomes.a.unread).toBe(false);
  });

  it("remembers outcomes across restarts", async () => {
    useSessionInboxStore.getState().actions.recordOutcome("a", "error", false);
    const saved = localStorage.getItem("athas-agent-session-inbox-v1") ?? "{}";
    useSessionInboxStore.setState({ outcomes: {} });
    localStorage.setItem("athas-agent-session-inbox-v1", saved);
    await useSessionInboxStore.persist.rehydrate();
    expect(useSessionInboxStore.getState().outcomes.a).toMatchObject({ outcome: "error" });
  });
});
