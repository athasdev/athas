import type { SubscriptionInfo } from "@/features/window/services/auth-api";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";

export type AutocompleteUsageSummary = {
  periodStart: string;
  periodEnd: string;
  budgetCents: number;
  reservedCents: number;
  spendCents: number;
  remainingCents: number;
  requestsCount: number;
  promptTokens: number;
  completionTokens: number;
  maxRequestCostCents: number;
};

export function extractAutocompleteUsage(subscription: unknown): AutocompleteUsageSummary | null {
  if (!subscription || typeof subscription !== "object") return null;

  const container = subscription as Record<string, unknown>;
  const autocomplete =
    container.autocomplete && typeof container.autocomplete === "object"
      ? (container.autocomplete as Record<string, unknown>)
      : null;
  const usageCandidate = autocomplete?.usage;

  if (!usageCandidate || typeof usageCandidate !== "object") return null;

  const usage = usageCandidate as Record<string, unknown>;
  if (
    typeof usage.periodStart !== "string" ||
    typeof usage.periodEnd !== "string" ||
    typeof usage.budgetCents !== "number" ||
    typeof usage.spendCents !== "number"
  ) {
    return null;
  }

  return usage as unknown as AutocompleteUsageSummary;
}

export function getAccountPlanLabel(
  subscription: SubscriptionInfo | null,
  isAuthenticated: boolean,
): string {
  const isEnterprise = subscription?.subscription?.plan === "enterprise";
  const isTeams = Boolean(subscription?.collaboration?.enabled);
  const isPro = hasProductCapability(subscription, "hostedAi");

  if (isEnterprise) return "Enterprise";
  if (isTeams) return "Teams";
  if (isPro) return "Pro";
  return isAuthenticated ? "Free" : "Guest";
}

export function getAiUsageModeLabel(params: {
  isAuthenticated: boolean;
  subscription: SubscriptionInfo | null;
  hasOpenRouterKey: boolean;
}): string {
  const { isAuthenticated, subscription, hasOpenRouterKey } = params;
  const enterprisePolicy = subscription?.enterprise?.policy;
  const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
  const isPro = hasProductCapability(subscription, "hostedAi");
  const aiAllowedByPolicy = managedPolicy ? managedPolicy.aiCompletionEnabled : true;
  const byokAllowedByPolicy = managedPolicy ? managedPolicy.allowByok : true;

  if (!isAuthenticated) return "Guest";
  if (!aiAllowedByPolicy) return "Blocked";
  if (isPro) return "Hosted";
  if (!byokAllowedByPolicy) return "Blocked";
  return hasOpenRouterKey ? "BYOK" : "Key required";
}

export function getUsageProgress(usage: AutocompleteUsageSummary | null): number {
  if (!usage || usage.budgetCents <= 0) return 0;

  return Math.min(100, Math.max(0, (usage.spendCents / usage.budgetCents) * 100));
}

import { formatShortDate } from "@/utils/date";

export function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatUsageDate(value: string): string {
  return formatShortDate(value);
}
