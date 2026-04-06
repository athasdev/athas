import { describe, expect, it } from "vite-plus/test";
import { groupAcpActivity } from "./acp-activity-groups";

describe("groupAcpActivity", () => {
  it("groups running, recent, and error activity without duplicate signatures", () => {
    const base = new Date("2026-03-18T12:00:00Z");
    const grouped = groupAcpActivity([
      {
        id: "1",
        kind: "tool",
        label: "Read",
        detail: "running",
        state: "running",
        timestamp: new Date(base),
      },
      {
        id: "2",
        kind: "tool",
        label: "Read",
        detail: "running",
        state: "running",
        timestamp: new Date(base.getTime() + 1000),
      },
      {
        id: "3",
        kind: "error",
        label: "Agent error",
        detail: "boom",
        state: "error",
        timestamp: new Date(base.getTime() + 2000),
      },
    ]);

    expect(grouped.running).toHaveLength(1);
    expect(grouped.errors).toHaveLength(1);
    expect(grouped.counts.tools).toBe(1);
    expect(grouped.counts.errors).toBe(1);
  });
});
