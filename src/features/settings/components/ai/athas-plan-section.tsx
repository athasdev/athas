import { openUrl } from "@tauri-apps/plugin-opener";
import { getServiceUrls } from "@/config/services";
import {
  formatUsdCents,
  getHostedUsageState,
  getHostedUsageTone,
} from "@/features/ai/lib/hosted-usage";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useProFeature } from "@/features/window/hooks/use-pro-feature";
import { useSubscriptionRefresh } from "@/features/window/hooks/use-subscription-refresh";
import { getAccountPlanLabel } from "@/features/window/lib/account-usage";
import { useAuthStore } from "@/features/window/stores/auth.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Progress } from "@/ui/progress";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import Section, { SettingRow } from "../settings-section";
import { describeIncludedCredit } from "../../lib/athas-credit";

function openBilling() {
  void openUrl(getServiceUrls().dashboardBillingUrl).catch((error: unknown) =>
    console.error("Failed to open billing:", error),
  );
}

/** Plan, included credit, and pay-as-you-go balance for Athas-hosted models. */
export function AthasPlanSection() {
  useSubscriptionRefresh();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const credits = subscription?.intelligence?.credits ?? null;
  const { hasIntelligence } = useProFeature();
  const { isSigningIn, signIn } = useDesktopSignIn();
  const usage = getHostedUsageState(credits);
  const planLabel = getAccountPlanLabel(subscription, isAuthenticated);
  const policy = subscription?.enterprise?.policy;
  const managedPolicy = policy?.managedMode ? policy : null;
  const balance =
    usage?.walletBalanceCents != null ? formatUsdCents(usage.walletBalanceCents) : null;

  return (
    <Section title="Athas" icon={<ProviderIcon providerId="athas" />}>
      {!isAuthenticated ? (
        <SettingRow label="Plan" description="Sign in to use Athas models">
          <Button
            variant="accent"
            onClick={() => void signIn().catch(() => undefined)}
            disabled={isSigningIn}
          >
            {isSigningIn ? "Signing in…" : "Sign in"}
          </Button>
        </SettingRow>
      ) : (
        <SettingRow
          label="Plan"
          labelAccessory={<Badge tone={hasIntelligence ? "accent" : "neutral"}>{planLabel}</Badge>}
          description={
            hasIntelligence
              ? usage
                ? describeIncludedCredit(usage)
                : undefined
              : "Pro includes $10 of Athas AI every month"
          }
          activateOnClick={false}
        >
          {hasIntelligence ? (
            <div className="flex items-center gap-2">
              {usage ? (
                <Progress
                  className="w-24"
                  value={usage.usedPercent}
                  tone={getHostedUsageTone(usage.level)}
                  aria-label={`Included credit: ${usage.usedPercent}% used`}
                />
              ) : null}
              <Button variant="ghost" onClick={openBilling}>
                Manage
              </Button>
            </div>
          ) : (
            <Button variant="accent" onClick={() => void openUrl(getServiceUrls().pricingUrl)}>
              Upgrade
            </Button>
          )}
        </SettingRow>
      )}
      {isAuthenticated ? (
        <SettingRow
          label="Balance"
          description="Used after included credit, at list price +10%"
          activateOnClick={false}
        >
          <div className="flex items-center gap-2">
            {balance ? <span className="text-foreground tabular-nums">{balance}</span> : null}
            <Button onClick={openBilling}>Add Credit</Button>
          </div>
        </SettingRow>
      ) : null}
      {managedPolicy ? (
        <SettingRow
          label="Managed by your organization"
          description={
            [
              managedPolicy.aiChatEnabled ? null : "Chat off",
              managedPolicy.aiCompletionEnabled ? null : "Tab completion off",
              managedPolicy.allowByok ? null : "No personal keys",
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
          activateOnClick={false}
        >
          <Badge tone="accent">Managed</Badge>
        </SettingRow>
      ) : null}
    </Section>
  );
}
