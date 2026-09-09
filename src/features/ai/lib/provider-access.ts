import type { SubscriptionInfo } from "@/features/window/services/auth-api";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";

export function canUseIntelligenceProvider(
  providerId: string,
  subscription: SubscriptionInfo | null,
): boolean {
  return providerId === "openrouter" && hasProductCapability(subscription, "intelligence");
}

export function canUseProviderWithoutApiKey(params: {
  providerId: string;
  subscription: SubscriptionInfo | null;
  hasStoredKey: boolean;
  requiresApiKey: boolean;
}): boolean {
  const { hasStoredKey, requiresApiKey } = params;
  if (params.providerId === "athas") return params.subscription !== null;

  if (!requiresApiKey) {
    return true;
  }

  if (hasStoredKey) {
    return true;
  }

  return false;
}
