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

  return (
    <Section
      title="Athas"
      description="Models hosted by Athas. No API key needed, usage comes out of your plan or balance."
    >
      {isAuthenticated ? (
        <SettingRow
          label="Plan"
          description={
            hasIntelligence
              ? `Includes ${usage ? formatUsdCents(usage.allowanceCents) : "$10"} of Athas AI every month.`
              : "Pro includes $10 of Athas AI every month."
          }
          activateOnClick={false}
        >
          <div className="flex items-center gap-2">
            <Badge tone={hasIntelligence ? "accent" : "neutral"}>{planLabel}</Badge>
            {hasIntelligence ? (
              <Button onClick={openBilling}>Manage billing</Button>
            ) : (
              <Button onClick={() => void openUrl(getServiceUrls().pricingUrl)}>
                Upgrade to Pro
              </Button>
            )}
          </div>
        </SettingRow>
      ) : (
        <SettingRow label="Account" description="Sign in to use Athas models.">
          <Button
            variant="accent"
            onClick={() => void signIn().catch(() => undefined)}
            disabled={isSigningIn}
          >
            {isSigningIn ? "Signing in…" : "Sign in"}
          </Button>
        </SettingRow>
      )}
      {usage ? (
        <SettingRow
          label="Included credit"
          description={describeIncludedCredit(usage)}
          activateOnClick={false}
        >
          <Progress
            className="w-40"
            value={usage.usedPercent}
            tone={getHostedUsageTone(usage.level)}
            aria-label={`Included credit: ${usage.usedPercent}% used`}
          />
        </SettingRow>
      ) : null}
      {isAuthenticated ? (
        <SettingRow
          label="Pay-as-you-go balance"
          description="Used once included credit runs out, at the model's list price plus 10%."
          activateOnClick={false}
        >
          <div className="flex items-center gap-2">
            {usage?.walletBalanceCents != null ? (
              <span className="text-foreground tabular-nums">
                {formatUsdCents(usage.walletBalanceCents)}
              </span>
            ) : null}
            <Button onClick={openBilling}>Add credit</Button>
          </div>
        </SettingRow>
      ) : null}
      {managedPolicy ? (
        <SettingRow
          label="Managed by your organization"
          description={
            [
              managedPolicy.aiChatEnabled ? null : "Chat is turned off.",
              managedPolicy.aiCompletionEnabled ? null : "Tab completion is turned off.",
              managedPolicy.allowByok ? null : "Your own API keys are not allowed.",
            ]
              .filter(Boolean)
              .join(" ") || "Your organization manages AI access."
          }
          activateOnClick={false}
        >
          <Badge tone="accent">Managed</Badge>
        </SettingRow>
      ) : null}
    </Section>
  );
}
