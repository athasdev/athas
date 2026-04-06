import { openUrl } from "@tauri-apps/plugin-opener";
import { CreditCard, ExternalLink, LogIn } from "lucide-react";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { Button } from "@/ui/button";
import Section, { SettingRow } from "../settings-section";

export const AccountSettings = () => {
  const user = useAuthStore((state) => state.user);
  const subscription = useAuthStore((state) => state.subscription);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { isPro } = useProFeature();
  const { isSigningIn, signIn } = useDesktopSignIn();

  const planLabel =
    subscription?.subscription?.plan === "enterprise" ? "Enterprise" : isPro ? "Pro" : "Free";

  const handleManageAccount = async () => {
    await openUrl("https://athas.dev/dashboard");
  };

  const handleViewPricing = async () => {
    await openUrl("https://athas.dev/pricing");
  };

  return (
    <div className="space-y-4">
      <Section title="Account">
        <SettingRow
          label={isAuthenticated ? "Signed In" : "Sign In"}
          description={
            isAuthenticated
              ? "Your current account session."
              : "Sign in to access account and subscription features."
          }
        >
          {isAuthenticated ? (
            <span className="ui-font text-[length:var(--app-ui-control-font-size)] text-text-lighter">
              {user?.email}
            </span>
          ) : (
            <Button
              variant="secondary"
              size="xs"
              onClick={signIn}
              disabled={isSigningIn}
              className="ui-text-sm"
            >
              <LogIn />
              {isSigningIn ? "Signing In..." : "Sign In"}
            </Button>
          )}
        </SettingRow>

        {isAuthenticated && (
          <SettingRow
            label="Plan"
            description="Free includes core features. Pro unlocks premium capabilities like custom extension generation."
          >
            <span className="ui-font text-[length:var(--app-ui-control-font-size)] text-text">
              {planLabel}
            </span>
          </SettingRow>
        )}
      </Section>

      {isAuthenticated && (
        <Section title="Billing">
          <SettingRow
            label="Upgrade to Pro"
            description="Open pricing to compare plans and upgrade your account."
          >
            <Button
              variant="secondary"
              size="xs"
              onClick={handleViewPricing}
              className="ui-text-sm"
            >
              <CreditCard />
              {isPro ? "View Pricing" : "Upgrade to Pro"}
            </Button>
          </SettingRow>

          <SettingRow
            label="Manage Account"
            description="Open your Athas dashboard to manage billing and subscription details."
          >
            <Button
              variant="secondary"
              size="xs"
              onClick={handleManageAccount}
              className="ui-text-sm"
            >
              <ExternalLink />
              Open Dashboard
            </Button>
          </SettingRow>
        </Section>
      )}
    </div>
  );
};
