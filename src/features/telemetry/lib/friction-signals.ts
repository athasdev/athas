export const frictionAreas = [
  "startup",
  "agent",
  "navigation",
  "layout",
  "extensions",
  "feedback",
] as const;

export const frictionSignals = [
  "slow_ready",
  "retry",
  "cancel",
  "queue_discard",
  "restore_failed",
  "prompt_dismissed",
  "opened",
  "submitted",
] as const;

export const frictionDurationBuckets = [
  "under_1s",
  "1_to_5s",
  "5_to_30s",
  "30_to_120s",
  "over_120s",
] as const;

export type FrictionArea = (typeof frictionAreas)[number];
export type FrictionSignal = (typeof frictionSignals)[number];
export type FrictionDurationBucket = (typeof frictionDurationBuckets)[number];

export interface FrictionSignalInput {
  area: FrictionArea;
  signal: FrictionSignal;
  durationBucket?: FrictionDurationBucket;
  count?: number;
}

export function bucketFrictionDuration(durationMs: number): FrictionDurationBucket {
  if (durationMs < 1_000) return "under_1s";
  if (durationMs < 5_000) return "1_to_5s";
  if (durationMs < 30_000) return "5_to_30s";
  if (durationMs < 120_000) return "30_to_120s";
  return "over_120s";
}

export function createFrictionPayload(input: FrictionSignalInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    area: input.area,
    signal: input.signal,
  };

  if (input.durationBucket) {
    payload.duration_bucket = input.durationBucket;
  }

  if (input.count !== undefined && Number.isFinite(input.count)) {
    payload.count = Math.min(99, Math.max(1, Math.round(input.count)));
  }

  return payload;
}
