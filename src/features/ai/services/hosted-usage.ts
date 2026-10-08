import type { IntelligenceCredits } from "@/features/auth/services/auth-api";

/**
 * Where a Pro account stands against this period's included Athas credit: `included_exhausted`
 * means usage continues from the pay-as-you-go balance, `exhausted` means nothing is left.
 */
export type HostedUsageLevel = "ok" | "low" | "included_exhausted" | "exhausted";

/** Included credit and balance, in USD cents at list price plus the usage markup. */
export interface HostedUsageState {
  /** Settled plus in-flight usage as a share of the included credit, 0 to 100. */
  usedPercent: number;
  level: HostedUsageLevel;
  /** Included credit still available once in-flight requests settle. */
  remainingCents: number;
  usedCents: number;
  pendingCents: number;
  allowanceCents: number;
  /** Pay-as-you-go balance used after the included credit, or null when the server has none. */
  walletBalanceCents: number | null;
  periodEnd: Date | null;
}

const LOW_USAGE_PERCENT = 80;

const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const resetFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** A USD cent amount, which may be fractional, as dollars such as `$4.20`. */
export function formatUsdCents(cents: number) {
  return usdFormatter.format(cents / 100);
}

export function formatResetDate(date: Date) {
  return resetFormatter.format(date);
}

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

/** Progress tone for the included credit: running on the balance is normal, not a failure. */
export function getHostedUsageTone(level: HostedUsageLevel) {
  if (level === "exhausted") return "error" as const;
  if (level === "low") return "warning" as const;
  return "accent" as const;
}

/** A short label for where usage stands, such as `$4.20 included left` or `Using balance`. */
export function getHostedUsageHeadline(usage: HostedUsageState) {
  if (usage.level === "included_exhausted") return "Using balance";
  if (usage.level === "exhausted") return "Out of credit";
  return `${formatUsdCents(usage.remainingCents)} included left`;
}

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

function formatPricePerMillion(usd: number) {
  return Number.isInteger(usd) ? `$${usd}` : priceFormatter.format(usd);
}

/**
 * A compact list price hint for a hosted model row, input then output in USD per million tokens,
 * such as `$3 / $15`. Undefined until the catalog reports both prices.
 */
export function getHostedModelPriceHint(model: { input?: number; output?: number }) {
  const { input, output } = model;
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0)
    return undefined;
  return `${formatPricePerMillion(input)} / ${formatPricePerMillion(output)}`;
}
