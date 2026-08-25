import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";

export function useProFeature() {
  const user = useAuthStore((state) => state.user);
  const subscription = useAuthStore((state) => state.subscription);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const hasIntelligence = hasProductCapability(subscription, "intelligence");
  const hasSettingsSync = hasProductCapability(subscription, "settingsSync");
  const hasCloudWorkspaces = hasProductCapability(subscription, "cloudWorkspaces");
  const isPro = user?.subscription_status === "pro" || hasIntelligence || hasSettingsSync;

  return {
    isPro,
    hasIntelligence,
    hasHostedAi: hasIntelligence,
    hasSettingsSync,
    hasCloudWorkspaces,
    isAuthenticated,
    subscriptionStatus: subscription?.status ?? user?.subscription_status ?? "free",
  };
}
