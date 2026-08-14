import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";

export function useProFeature() {
  const user = useAuthStore((state) => state.user);
  const subscription = useAuthStore((state) => state.subscription);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const hasHostedAi = hasProductCapability(subscription, "hostedAi");
  const hasSettingsSync = hasProductCapability(subscription, "settingsSync");
  const isPro = user?.subscription_status === "pro" || hasHostedAi || hasSettingsSync;

  return {
    isPro,
    hasHostedAi,
    hasSettingsSync,
    isAuthenticated,
    subscriptionStatus: subscription?.status ?? user?.subscription_status ?? "free",
  };
}
