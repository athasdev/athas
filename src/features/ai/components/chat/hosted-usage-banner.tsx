import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { getServiceUrls } from "@/config/services";
import {
  formatResetDate,
  formatUsdCents,
  getHostedUsageState,
  type HostedUsageLevel,
} from "@/features/ai/lib/hosted-usage";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useSubscriptionRefresh } from "@/features/window/hooks/use-subscription-refresh";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";

/**
 * Tells a hosted chat, above the composer, when this period's included Athas credit is at 80%,
 * when usage has moved on to the pay-as-you-go balance, or when nothing is left.
 */
export function HostedUsageBanner() {
  useSubscriptionRefresh();
  const credits = useAuthStore((state) => state.subscription?.intelligence?.credits ?? null);
  const [dismissedLevel, setDismissedLevel] = useState<HostedUsageLevel | null>(null);
  const usage = getHostedUsageState(credits);
  if (!usage || usage.level === "ok" || usage.level === dismissedLevel) return null;

  const resets = usage.periodEnd
    ? ` Included credit resets ${formatResetDate(usage.periodEnd)}.`
    : "";
  const balance =
    usage.walletBalanceCents === null ? null : formatUsdCents(usage.walletBalanceCents);
  const content =
    usage.level === "low"
      ? {
          tone: "warning" as const,
          title: `${usage.usedPercent}% of included credit used`,
          description: `${formatUsdCents(usage.remainingCents)} of ${formatUsdCents(usage.allowanceCents)} left.${
            balance ? ` After that, usage continues from your balance (${balance}).` : ""
          }${resets}`,
          action: "Manage billing",
        }
      : usage.level === "included_exhausted"
        ? {
            tone: "info" as const,
            title: "Now using your pay-as-you-go balance",
            description: `Your included credit is used up. Athas models keep working from your balance (${balance ?? "$0.00"} left) at list price +10%.${resets}`,
            action: "Add credit",
          }
        : {
            tone: "error" as const,
            title: "Out of Athas credit",
            description:
              balance === null
                ? `Your included credit is used up. Choose another model until it resets.${resets}`
                : `Add pay-as-you-go credit to keep using Athas models, or choose another model.${resets}`,
            action: balance === null ? "Manage billing" : "Add credit",
          };

  return (
    <Alert tone={content.tone} role="status" className="shrink-0">
      <AlertTitle>{content.title}</AlertTitle>
      <AlertDescription>{content.description}</AlertDescription>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() =>
            void openUrl(getServiceUrls().dashboardBillingUrl).catch((error: unknown) =>
              console.error("Failed to open billing:", error),
            )
          }
        >
          {content.action}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setDismissedLevel(usage.level)}
        >
          Dismiss
        </Button>
      </div>
    </Alert>
  );
}
