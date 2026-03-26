import { describe, expect, test } from "bun:test";
import {
  addAcpPermissionRequest,
  appendAcpActivityEvent,
  completeAcpActivityTool,
  getAcpPlanEntryCounts,
  getPendingAcpPermissions,
  getRecentAcpToolEvents,
  getStaleAcpPermissions,
  markPendingAcpPermissionsStale,
  normalizeChatAcpActivity,
  resolveAcpPermissionRequest,
  setAcpActivityPlanEntries,
} from "./chat-acp-activity";

describe("chat ACP activity helpers", () => {
  test("normalizes empty activity", () => {
    expect(normalizeChatAcpActivity()).toEqual({
      events: [],
      planEntries: [],
      permissions: [],
    });
  });

  test("appends and completes tool events", () => {
    const started = appendAcpActivityEvent(null, {
      id: "tool-1",
      kind: "tool",
      label: "Read",
      detail: "running",
      state: "running",
      tool: {
        input: { file_path: "/tmp/example.ts" },
      },
    });

    const completed = completeAcpActivityTool(started, "tool-1", true, {
      output: "done",
      locations: [{ path: "/tmp/example.ts", line: 4 }],
    });
    expect(completed.events).toHaveLength(1);
    expect(completed.events[0]?.detail).toBe("completed");
    expect(completed.events[0]?.state).toBe("success");
    expect(completed.events[0]?.tool).toEqual({
      input: { file_path: "/tmp/example.ts" },
      output: "done",
      locations: [{ path: "/tmp/example.ts", line: 4 }],
    });
  });

  test("stores structured plan entries", () => {
    const activity = setAcpActivityPlanEntries(null, [
      { content: "Inspect repo", priority: "high", status: "in_progress" },
      { content: "Ship", priority: "medium", status: "completed" },
    ]);

    expect(activity.planEntries).toEqual([
      { content: "Inspect repo", priority: "high", status: "in_progress" },
      { content: "Ship", priority: "medium", status: "completed" },
    ]);
    expect(getAcpPlanEntryCounts(activity)).toEqual({
      total: 2,
      completed: 1,
      inProgress: 1,
      pending: 0,
    });
  });

  test("tracks permission lifecycle", () => {
    const requested = addAcpPermissionRequest(null, {
      requestId: "perm-1",
      description: "Write file",
      permissionType: "write",
      resource: "/tmp/file",
    });
    expect(getPendingAcpPermissions(requested)).toHaveLength(1);

    const approved = resolveAcpPermissionRequest(requested, "perm-1", "approved");
    expect(approved.permissions[0]?.status).toBe("approved");
  });

  test("marks unresolved permissions stale", () => {
    const requested = addAcpPermissionRequest(null, {
      requestId: "perm-2",
      description: "Delete file",
      permissionType: "delete",
      resource: "/tmp/file",
    });

    const stale = markPendingAcpPermissionsStale(requested);
    expect(getPendingAcpPermissions(stale)).toHaveLength(0);
    expect(getStaleAcpPermissions(stale)).toHaveLength(1);
  });

  test("returns recent tool events in reverse chronological order", () => {
    const running = appendAcpActivityEvent(null, {
      id: "tool-1",
      kind: "tool",
      label: "Read",
      detail: "running",
      state: "running",
    });
    const complete = completeAcpActivityTool(running, "tool-1", true);
    const next = appendAcpActivityEvent(complete, {
      id: "tool-2",
      kind: "tool",
      label: "Edit",
      detail: "running",
      state: "running",
    });

    expect(getRecentAcpToolEvents(next).map((event) => event.id)).toEqual(["tool-2", "tool-1"]);
  });
});
