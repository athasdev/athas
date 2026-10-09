import { useAuthStore } from "@/features/auth/stores/auth.store";
import { hasProductCapability } from "@/features/auth/services/product-capabilities";
import type { AuthUser, SubscriptionInfo } from "@/features/auth/services/auth-api";

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
  const hasCloudAgents = hasProductCapability(subscription, "cloudAgents");
  const hasPreviews = hasProductCapability(subscription, "previews");

  return {
    hasIntelligence,
    hasSettingsSync,
    hasCloudWorkspaces,
    hasCloudAgents,
    hasPreviews,
  };
}

export function useProFeature() {
  const user = useAuthStore((state) => state.user);
  const subscription = useAuthStore((state) => state.subscription);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const { hasIntelligence, hasSettingsSync, hasCloudWorkspaces, hasCloudAgents, hasPreviews } =
    resolveProFeatureAccess(user, subscription);
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
    hasCloudAgents,
    hasPreviews,
    isAuthenticated,
    subscriptionStatus:
      subscription?.status ?? user?.subscription_status ?? user?.subscriptionStatus ?? "free",
  };
}
