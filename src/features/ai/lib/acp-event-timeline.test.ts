import { describe, expect, test } from "vite-plus/test";
import {
  appendChatAcpEvent,
  refreshRunningAcpEvent,
  updateAcpEventState,
} from "./acp-event-timeline";

describe("acp event timeline", () => {
  test("refreshes an existing running event in place", () => {
    const events = appendChatAcpEvent([], {
      id: "thinking-1",
      kind: "thinking",
      label: "Thinking",
      state: "running",
    });

    const refreshed = refreshRunningAcpEvent(events, "thinking-1");

    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.id).toBe("thinking-1");
    expect(refreshed[0]?.state).toBe("running");
    expect(refreshed[0]?.timestamp.getTime()).toBeGreaterThanOrEqual(
      events[0]?.timestamp.getTime() ?? 0,
    );
  });

  test("marks an active event complete without appending a new row", () => {
    const events = appendChatAcpEvent([], {
      id: "thinking-1",
      kind: "thinking",
      label: "Thinking",
      state: "running",
    });

    const completed = updateAcpEventState(events, "thinking-1", {
      detail: "completed",
      state: "success",
    });

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      id: "thinking-1",
      kind: "thinking",
      label: "Thinking",
      detail: "completed",
      state: "success",
    });
  });
});
