import { useAuthStore } from "@/features/window/stores/auth-store";

export function useProFeature() {
  const user = useAuthStore((state) => state.user);
  const subscription = useAuthStore((state) => state.subscription);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const isPro = user?.subscription_status === "pro" || subscription?.status === "pro";

  return {
    isPro,
    isAuthenticated,
    subscriptionStatus: subscription?.status ?? user?.subscription_status ?? "free",
  };
}
