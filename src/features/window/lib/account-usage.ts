import type { SubscriptionInfo } from "@/features/window/services/auth-api";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";

export function getAccountPlanLabel(
  subscription: SubscriptionInfo | null,
  isAuthenticated: boolean,
): string {
  const isEnterprise = subscription?.subscription?.plan === "enterprise";
  const isTeams = subscription?.subscription?.plan === "teams";
  const isPro = hasProductCapability(subscription, "intelligence");

  if (isEnterprise) return "Enterprise";
  if (isTeams) return "Teams";
  if (isPro) return "Pro";
  return isAuthenticated ? "Free" : "Guest";
}
