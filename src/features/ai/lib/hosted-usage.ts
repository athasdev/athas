import type { IntelligenceCredits } from "@/features/window/services/auth-api";

/** Where a Pro account stands against this period's included hosted AI usage. */
export type HostedUsageLevel = "ok" | "low" | "included_exhausted" | "exhausted";

export interface HostedUsageState {
  /** Settled plus in-flight usage as a share of the allowance, 0 to 100. */
  usedPercent: number;
  level: HostedUsageLevel;
  /** Included usage still available once in-flight requests settle. */
  remainingCents: number;
  usedCents: number;
  pendingCents: number;
  allowanceCents: number;
  /** Prepaid balance hosted turns draw from after the allowance, when the server reports it. */
  walletBalanceCents: number | null;
  periodEnd: Date | null;
}

export const LOW_USAGE_PERCENT = 80;

export function getHostedUsageState(
  credits: IntelligenceCredits | null | undefined,
): HostedUsageState | null {
  if (!credits || credits.allowanceCents <= 0) return null;
  const pendingCents = Math.max(0, credits.pendingCents ?? 0);
  const usedCents = Math.max(0, credits.usedCents);
  const committed = usedCents + pendingCents;
  const remainingCents = Math.max(
    0,
    Math.min(credits.remainingCents, credits.allowanceCents - committed),
  );
  const usedPercent = Math.min(
    100,
    Math.max(0, Math.round((committed / credits.allowanceCents) * 100)),
  );
  const walletBalanceCents =
    typeof credits.walletBalanceCents === "number" && Number.isFinite(credits.walletBalanceCents)
      ? Math.max(0, credits.walletBalanceCents)
      : null;
  const periodEnd = credits.periodEnd ? new Date(credits.periodEnd) : null;
  const level: HostedUsageLevel =
    remainingCents <= 0
      ? walletBalanceCents
        ? "included_exhausted"
        : "exhausted"
      : usedPercent >= LOW_USAGE_PERCENT
        ? "low"
        : "ok";
  return {
    usedPercent: remainingCents <= 0 ? 100 : usedPercent,
    level,
    remainingCents,
    usedCents,
    pendingCents,
    allowanceCents: credits.allowanceCents,
    walletBalanceCents,
    periodEnd: periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd : null,
  };
}
