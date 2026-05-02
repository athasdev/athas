import type { SubscriptionInfo } from "@/features/window/services/auth-api";

export function canUseHostedProvider(
  providerId: string,
  subscription: SubscriptionInfo | null,
): boolean {
  return providerId === "openrouter" && subscription?.status === "pro";
}

export function canUseProviderWithoutApiKey(params: {
  providerId: string;
  subscription: SubscriptionInfo | null;
  hasStoredKey: boolean;
  requiresApiKey: boolean;
}): boolean {
  const { providerId, subscription, hasStoredKey, requiresApiKey } = params;

  if (!requiresApiKey) {
    return true;
  }

  if (hasStoredKey) {
    return true;
  }

  return canUseHostedProvider(providerId, subscription);
}
