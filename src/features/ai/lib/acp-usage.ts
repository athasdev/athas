import type { AcpCost, AcpUsageUpdate } from "@/features/ai/types/acp.types";

/** Context use at or above this share of the window is shown as a warning. */
const CONTEXT_WARNING_RATIO = 0.8;
/** Context use at or above this share of the window is shown as an error. */
const CONTEXT_ERROR_RATIO = 0.95;

export type ContextUsageTone = "accent" | "warning" | "error";

/** Share of the context window in use, from 0 to 100. */
export function getContextUsagePercent(usage: Pick<AcpUsageUpdate, "used" | "size">): number {
  if (usage.size <= 0) return 0;
  return Math.min(100, Math.max(0, (usage.used / usage.size) * 100));
}

export function getContextUsageTone(
  usage: Pick<AcpUsageUpdate, "used" | "size">,
): ContextUsageTone {
  const ratio = getContextUsagePercent(usage) / 100;
  if (ratio >= CONTEXT_ERROR_RATIO) return "error";
  if (ratio >= CONTEXT_WARNING_RATIO) return "warning";
  return "accent";
}

/** A token count in the short form agents use for context windows: 850, 12k, 200k, 1M. */
export function formatTokenCount(tokens: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: tokens >= 1000 && tokens < 10_000 ? 1 : 0,
  })
    .format(tokens)
    .replace(/K$/, "k");
}

/**
 * The session's cost in its own currency. Small amounts keep more digits, so a
 * session that cost a fraction of a cent does not read as free.
 */
export function formatUsageCost(cost: AcpCost, locale?: string): string {
  const fractionDigits = cost.amount > 0 && cost.amount < 0.01 ? 4 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: cost.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: fractionDigits,
    }).format(cost.amount);
  } catch {
    // Not an ISO 4217 code; show the amount with whatever the agent sent.
    const amount = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: fractionDigits,
    }).format(cost.amount);
    return cost.currency ? `${amount} ${cost.currency}` : amount;
  }
}

/** "42% of 200k context", plus the cost when the agent reports one. */
export function describeContextUsage(usage: AcpUsageUpdate, locale?: string): string {
  const percent = Math.round(getContextUsagePercent(usage));
  const context = `${percent}% of ${formatTokenCount(usage.size, locale)} context`;
  const used = `${formatTokenCount(usage.used, locale)} tokens used`;
  const cost = usage.cost ? ` · ${formatUsageCost(usage.cost, locale)} spent` : "";
  return `${context} (${used})${cost}`;
}
