import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { getServiceUrls } from "@/config/services";
import { getHostedUsageState, type HostedUsageLevel } from "@/features/ai/lib/hosted-usage";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useSubscriptionRefresh } from "@/features/window/hooks/use-subscription-refresh";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";

const creditFormatter = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * Warns above the composer of a hosted chat when this period's included Athas usage is at
 * 80% or used up, with a way to top up or manage billing.
 */
export function HostedUsageBanner() {
  useSubscriptionRefresh();
  const credits = useAuthStore((state) => state.subscription?.intelligence?.credits ?? null);
  const [dismissedLevel, setDismissedLevel] = useState<HostedUsageLevel | null>(null);
  const usage = getHostedUsageState(credits);
  if (!usage || usage.level === "ok" || usage.level === dismissedLevel) return null;

  const resets = usage.periodEnd ? ` It resets ${dateFormatter.format(usage.periodEnd)}.` : "";
  const content =
    usage.level === "low"
      ? {
          tone: "warning" as const,
          title: `${usage.usedPercent}% of included usage used`,
          description: `${creditFormatter.format(usage.remainingCents / 100)} of this period's included Athas usage is left.${resets}`,
          action: "Manage billing",
        }
      : usage.level === "included_exhausted"
        ? {
            tone: "info" as const,
            title: "Included usage used up",
            description: `Hosted turns now use your prepaid balance (${creditFormatter.format((usage.walletBalanceCents ?? 0) / 100)} left).${resets}`,
            action: "Top up",
          }
        : {
            tone: "error" as const,
            title: "Included usage used up",
            description: `Top up to keep using hosted models, or choose another model.${resets}`,
            action: "Top up",
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
          onClick={() => void openUrl(getServiceUrls().dashboardBillingUrl)}
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
