import { describe, expect, it } from "vite-plus/test";
import { formatMessageUsage } from "../lib/message-usage";

describe("message usage footer", () => {
  it("shows steps and cost of a multi-step turn", () => {
    expect(formatMessageUsage({ steps: 4, costCents: 3.2 }, "en-US")).toBe("4 steps · $0.03");
  });

  it("keeps sub-cent costs visible without false precision", () => {
    expect(formatMessageUsage({ steps: 1, costCents: 0.4 }, "en-US")).toBe("<$0.01");
  });

  it("shows nothing for a single free step", () => {
    expect(formatMessageUsage({ steps: 1, inputTokens: 10 })).toBeNull();
  });
});
