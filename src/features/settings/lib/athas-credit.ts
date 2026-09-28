import {
  formatResetDate,
  formatUsdCents,
  type HostedUsageState,
} from "@/features/ai/lib/hosted-usage";

/** One short line about the included credit, for the Athas row in Settings. */
export function describeIncludedCredit(usage: HostedUsageState) {
  const resets = usage.periodEnd ? ` · resets ${formatResetDate(usage.periodEnd)}` : "";
  if (usage.level === "included_exhausted") return `Included credit used, on balance${resets}`;
  if (usage.level === "exhausted")
    return usage.walletBalanceCents === null
      ? `Included credit used${resets}`
      : `Included credit used, add credit to continue${resets}`;
  return `${formatUsdCents(usage.remainingCents)} of ${formatUsdCents(usage.allowanceCents)} left${resets}`;
}
