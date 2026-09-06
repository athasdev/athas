import { beforeEach, describe, expect, it } from "vitest";
import { createAgentSessionChangeSet } from "../lib/review-model";
import { useAgentChangesStore } from "../stores/agent-changes.store";
import type { AgentChangeSession } from "../types/review.types";
import { getAgentSessionDiffs } from "../utils/open-agent-session-diff-buffer";

function record(diffs: Array<{ path: string; oldText: string; newText: string }>) {
  useAgentChangesStore.getState().actions.recordDiffs({
    sessionId: "chat-1",
    title: "Improve React docs",
    workspacePath: "/workspace",
    diffs,
  });
}

function session(): AgentChangeSession {
  const value = useAgentChangesStore.getState().sessions["chat-1"];
  if (!value) throw new Error("expected a recorded session");
  return value;
}

describe("agent session changes", () => {
  beforeEach(() => {
    useAgentChangesStore.setState({ sessions: {} });
  });

  it("keeps the session's original text as the baseline across repeated edits", () => {
    record([{ path: "/workspace/src/app.ts", oldText: "one", newText: "two" }]);
    record([{ path: "/workspace/src/app.ts", oldText: "two", newText: "three" }]);

    expect(session().files["/workspace/src/app.ts"]).toEqual({
      path: "/workspace/src/app.ts",
      oldText: "one",
      newText: "three",
    });
  });

  it("drops a file the agent edited and then put back", () => {
    record([{ path: "/workspace/src/app.ts", oldText: "one", newText: "two" }]);
    record([{ path: "/workspace/src/keep.ts", oldText: "a", newText: "b" }]);
    record([{ path: "/workspace/src/app.ts", oldText: "two", newText: "one" }]);

    const changeSet = createAgentSessionChangeSet(session());

    expect(changeSet.files.map((file) => file.path)).toEqual(["src/keep.ts"]);
    expect(getAgentSessionDiffs(session()).map((diff) => diff.file_path)).toEqual(["src/keep.ts"]);
  });

  it("summarizes counts against workspace-relative paths", () => {
    record([
      {
        path: "/workspace/src/app.ts",
        oldText: "one\ntwo\nthree",
        newText: "one\ntwo changed\nthree\nfour",
      },
    ]);

    const changeSet = createAgentSessionChangeSet(session());

    expect(changeSet.kind).toBe("agent-session");
    expect(changeSet.sessionId).toBe("chat-1");
    expect(changeSet.id).toBe("agent-session:chat-1");
    expect(changeSet.files).toEqual([{ path: "src/app.ts", additions: 2, deletions: 1 }]);
    expect(changeSet.additions).toBe(2);
    expect(changeSet.deletions).toBe(1);
    expect(changeSet.reviewed).toBe(false);
  });

  it("marks a session reviewed and reopens it when the agent edits again", () => {
    record([{ path: "/workspace/src/app.ts", oldText: "one", newText: "two" }]);
    useAgentChangesStore.getState().actions.markReviewed("chat-1");

    expect(createAgentSessionChangeSet(session()).reviewed).toBe(true);

    record([{ path: "/workspace/src/app.ts", oldText: "two", newText: "three" }]);

    expect(createAgentSessionChangeSet(session()).reviewed).toBe(false);
  });

  it("builds one diff per changed file with real hunks", () => {
    const oldText = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    record([
      { path: "/workspace/b.ts", oldText, newText: oldText.replace("line 20", "line 20!") },
      { path: "/workspace/a.ts", oldText: "", newText: "created" },
    ]);

    const diffs = getAgentSessionDiffs(session());

    expect(diffs.map((diff) => diff.file_path)).toEqual(["a.ts", "b.ts"]);
    expect(diffs[0].is_new).toBe(true);
    expect(diffs[1].lines.filter((line) => line.line_type === "added")).toHaveLength(1);
    expect(diffs[1].lines.filter((line) => line.line_type === "context")).toHaveLength(6);
  });
});
