import { describe, expect, it } from "vite-plus/test";
import {
  formatUsdCents,
  getHostedModelPriceHint,
  getHostedUsageHeadline,
  getHostedUsageState,
  getHostedUsageTone,
} from "../lib/hosted-usage";

const credits = {
  periodStart: "2026-09-01T00:00:00.000Z",
  periodEnd: "2026-10-01T00:00:00.000Z",
  allowanceCents: 1000,
  usedCents: 500,
  pendingCents: 0,
  remainingCents: 500,
  requestsCount: 10,
  usageMarkup: 1.1,
};

describe("hosted usage state", () => {
  it("counts in-flight usage toward the ring", () => {
    expect(getHostedUsageState({ ...credits, pendingCents: 350 })).toMatchObject({
      usedPercent: 85,
      level: "low",
      remainingCents: 150,
    });
  });

  it("keeps fractional cents from marked-up usage", () => {
    const usage = getHostedUsageState({ ...credits, usedCents: 12.1, remainingCents: 987.9 });
    expect(usage?.remainingCents).toBeCloseTo(987.9);
    expect(getHostedUsageHeadline(usage!)).toBe("$9.88 included left");
    expect(formatUsdCents(0.4)).toBe("$0.00");
  });

  it("continues from the balance once included credit is used up", () => {
    const usedUp = { ...credits, usedCents: 1000, remainingCents: 0 };
    const onBalance = getHostedUsageState({ ...usedUp, walletBalanceCents: 450 })!;
    expect(onBalance).toMatchObject({ level: "included_exhausted", walletBalanceCents: 450 });
    expect(getHostedUsageTone(onBalance.level)).toBe("accent");
    expect(getHostedUsageHeadline(onBalance)).toBe("Using balance");

    const empty = getHostedUsageState({ ...usedUp, walletBalanceCents: 0 })!;
    expect(empty).toMatchObject({ level: "exhausted", usedPercent: 100 });
    expect(getHostedUsageTone(empty.level)).toBe("error");
    expect(getHostedUsageState(usedUp)?.level).toBe("exhausted");
  });

  it("has nothing to show without included credit", () => {
    expect(getHostedUsageState(null)).toBeNull();
    expect(getHostedUsageState({ ...credits, allowanceCents: 0 })).toBeNull();
    expect(getHostedUsageState(credits)?.level).toBe("ok");
  });
});

describe("Hosted model price hint", () => {
  it("keeps sub-cent list prices instead of rounding them to cents", () => {
    expect(getHostedModelPriceHint({ input: 3, output: 15 })).toBe("$3 / $15");
    expect(getHostedModelPriceHint({ input: 0.3, output: 2.5 })).toBe("$0.30 / $2.50");
    expect(getHostedModelPriceHint({ input: 0.075, output: 0.3 })).toBe("$0.075 / $0.30");
    expect(getHostedModelPriceHint({ input: 1 })).toBeUndefined();
  });
});
