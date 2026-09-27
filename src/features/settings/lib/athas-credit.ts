import {
  formatResetDate,
  formatUsdCents,
  type HostedUsageState,
} from "@/features/ai/lib/hosted-usage";

/** One plain sentence about the included credit and what happens once it is used up. */
export function describeIncludedCredit(usage: HostedUsageState) {
  const resets = usage.periodEnd ? ` Resets ${formatResetDate(usage.periodEnd)}.` : "";
  const allowance = formatUsdCents(usage.allowanceCents);
  if (usage.level === "included_exhausted")
    return `All ${allowance} included used. Usage continues from your pay-as-you-go balance (${formatUsdCents(usage.walletBalanceCents ?? 0)} left).${resets}`;
  if (usage.level === "exhausted")
    return usage.walletBalanceCents === null
      ? `All ${allowance} included used.${resets}`
      : `All ${allowance} included used. Add credit to keep using Athas models.${resets}`;
  return `${formatUsdCents(usage.remainingCents)} of ${allowance} included left.${resets}`;
}
