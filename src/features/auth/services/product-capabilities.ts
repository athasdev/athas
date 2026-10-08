import type { ProductCapability, SubscriptionInfo } from "@/features/auth/services/auth-api";

export function hasProductCapability(
  subscription: SubscriptionInfo | null,
  capability: ProductCapability,
): boolean {
  if (subscription?.capabilities) {
    return subscription.capabilities[capability];
  }

  if (capability === "collaboration") return Boolean(subscription?.collaboration?.enabled);
  if (capability === "enterprisePolicy") return subscription?.enterprise?.has_access === true;
  return subscription?.status === "pro";
}
