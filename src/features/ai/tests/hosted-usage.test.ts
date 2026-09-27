import { describe, expect, it } from "vite-plus/test";
import { getHostedUsageState } from "../lib/hosted-usage";

const credits = {
  periodStart: "2026-09-01T00:00:00.000Z",
  periodEnd: "2026-10-01T00:00:00.000Z",
  allowanceCents: 2000,
  usedCents: 1000,
  pendingCents: 0,
  remainingCents: 1000,
  requestsCount: 10,
};

describe("hosted usage state", () => {
  it("counts in-flight usage toward the ring", () => {
    expect(getHostedUsageState({ ...credits, pendingCents: 700 })).toMatchObject({
      usedPercent: 85,
      level: "low",
      remainingCents: 300,
    });
  });

  it("marks the allowance used up, or covered by a prepaid balance", () => {
    const usedUp = { ...credits, usedCents: 2000, remainingCents: 0 };
    expect(getHostedUsageState(usedUp)).toMatchObject({ level: "exhausted", usedPercent: 100 });
    expect(getHostedUsageState({ ...usedUp, walletBalanceCents: 450 })).toMatchObject({
      level: "included_exhausted",
      walletBalanceCents: 450,
    });
  });

  it("has nothing to show without an allowance", () => {
    expect(getHostedUsageState(null)).toBeNull();
    expect(getHostedUsageState({ ...credits, allowanceCents: 0 })).toBeNull();
    expect(getHostedUsageState(credits)?.level).toBe("ok");
  });
});
