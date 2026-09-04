import { describe, expect, it } from "vitest";
import { bucketFrictionDuration, createFrictionPayload } from "../lib/friction-signals";

describe("friction signals", () => {
  it("uses coarse duration buckets", () => {
    expect(bucketFrictionDuration(999)).toBe("under_1s");
    expect(bucketFrictionDuration(1_000)).toBe("1_to_5s");
    expect(bucketFrictionDuration(30_000)).toBe("30_to_120s");
    expect(bucketFrictionDuration(120_000)).toBe("over_120s");
  });

  it("creates a content-free payload with a bounded count", () => {
    expect(
      createFrictionPayload({
        area: "agent",
        signal: "retry",
        durationBucket: "5_to_30s",
        count: 140,
      }),
    ).toEqual({
      area: "agent",
      signal: "retry",
      duration_bucket: "5_to_30s",
      count: 99,
    });
  });
});
