import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import type { AuthUser, SubscriptionInfo } from "@/features/window/services/auth-api";

export function resolveProFeatureAccess(
  user: Pick<AuthUser, "subscription_status" | "subscriptionStatus"> | null,
  subscription: SubscriptionInfo | null,
) {
  const hasProUserSnapshot =
    subscription === null &&
    (user?.subscription_status === "pro" || user?.subscriptionStatus === "pro");
  const hasIntelligence = hasProUserSnapshot || hasProductCapability(subscription, "intelligence");
  const hasSettingsSync = hasProUserSnapshot || hasProductCapability(subscription, "settingsSync");
  const hasCloudWorkspaces =
    hasProUserSnapshot || hasProductCapability(subscription, "cloudWorkspaces");

  return {
    hasIntelligence,
    hasSettingsSync,
    hasCloudWorkspaces,
  };
}

export function useProFeature() {
  const user = useAuthStore((state) => state.user);
  const subscription = useAuthStore((state) => state.subscription);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const { hasIntelligence, hasSettingsSync, hasCloudWorkspaces } = resolveProFeatureAccess(
    user,
    subscription,
  );
  const isPro =
    user?.subscription_status === "pro" ||
    user?.subscriptionStatus === "pro" ||
    hasIntelligence ||
    hasSettingsSync;

  return {
    isPro,
    hasIntelligence,
    hasHostedAi: hasIntelligence,
    hasSettingsSync,
    hasCloudWorkspaces,
    isAuthenticated,
    subscriptionStatus:
      subscription?.status ?? user?.subscription_status ?? user?.subscriptionStatus ?? "free",
  };
}
