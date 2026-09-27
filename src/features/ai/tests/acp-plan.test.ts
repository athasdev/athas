import { describe, expect, it } from "vite-plus/test";
import { deserializeAcpPlan } from "../lib/acp-plan";

describe("saved ACP plans", () => {
  it("keeps valid entries and drops malformed ones", () => {
    expect(
      deserializeAcpPlan(
        JSON.stringify([
          { content: "Read the bridge", priority: "high", status: "completed" },
          { content: "Wire the UI", priority: "medium", status: "in_progress" },
          { content: 3, priority: "low", status: "pending" },
          { content: "Unknown status", priority: "low", status: "skipped" },
        ]),
      ),
    ).toEqual([
      { content: "Read the bridge", priority: "high", status: "completed" },
      { content: "Wire the UI", priority: "medium", status: "in_progress" },
    ]);
  });

  it("returns nothing for missing, empty or corrupt values", () => {
    expect(deserializeAcpPlan(null)).toBeUndefined();
    expect(deserializeAcpPlan("[]")).toBeUndefined();
    expect(deserializeAcpPlan("{not json")).toBeUndefined();
    expect(deserializeAcpPlan('{"content":"x"}')).toBeUndefined();
  });
});
