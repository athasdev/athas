import { openExternalUrl } from "@/utils/external-url";
import { getServiceUrls } from "@/config/services";
import {
  formatResetDate,
  formatUsdCents,
  getHostedUsageHeadline,
  getHostedUsageState,
  getHostedUsageTone,
} from "@/features/ai/lib/hosted-usage";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import { useSubscriptionRefresh } from "@/features/auth/hooks/use-subscription-refresh";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { Button } from "@/ui/button";
import { SparkleIcon } from "@/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Progress, ProgressCircle, ProgressLabel, ProgressValue } from "@/ui/progress";
import { SidebarIconButton } from "@/ui/sidebar";

const USAGE_REFRESH_INTERVAL_MS = 3 * 60 * 1000;

/**
 * The bottom of the agents sidebar: on Pro, a usage ring whose card shows this period's included
 * Athas credit and the pay-as-you-go balance on hover or click; otherwise an upgrade prompt.
 */
export function AgentsPlanFooter() {
  useSubscriptionRefresh({ intervalMs: USAGE_REFRESH_INTERVAL_MS });
  const { hasIntelligence } = useProFeature();
  const credits = useAuthStore((state) => state.subscription?.intelligence?.credits ?? null);
  const services = getServiceUrls();
  const usage = getHostedUsageState(credits);

  if (!hasIntelligence) {
    return (
      <div className="shrink-0 px-chrome-inline py-2">
        <Button
          variant="ghost"
          size="sm"
          width="full"
          align="start"
          onClick={() => void openExternalUrl(services.pricingUrl)}
        >
          <SparkleIcon />
          <span>Upgrade to Pro</span>
        </Button>
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="shrink-0 px-chrome-inline py-2">
        <SidebarIconButton
          tooltip="Athas AI usage"
          aria-label="Open Athas AI usage"
          onClick={() => void openExternalUrl(services.dashboardBillingUrl)}
        >
          <SparkleIcon />
        </SidebarIconButton>
      </div>
    );
  }

  const tone = getHostedUsageTone(usage.level);
  const headline = getHostedUsageHeadline(usage);
  return (
    <div className="shrink-0 px-chrome-inline py-2">
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={200}
          render={
            <SidebarIconButton
              aria-label={`Athas AI usage: ${usage.usedPercent}% of included credit used, ${headline}`}
            />
          }
        >
          <ProgressCircle value={usage.usedPercent} tone={tone} />
        </PopoverTrigger>
        <PopoverContent side="top" align="start" size="default">
          <Progress value={usage.usedPercent} tone={tone} aria-label="Included credit used">
            <ProgressLabel>Included credit</ProgressLabel>
            <ProgressValue>{() => headline}</ProgressValue>
          </Progress>
          <div className="flex min-w-0 flex-col gap-0.5 text-subtle-foreground">
            <span>
              {formatUsdCents(usage.usedCents)} of {formatUsdCents(usage.allowanceCents)} included
              used
            </span>
            {usage.pendingCents > 0 ? (
              <span>{formatUsdCents(usage.pendingCents)} in progress</span>
            ) : null}
            {usage.walletBalanceCents !== null ? (
              <span>{formatUsdCents(usage.walletBalanceCents)} pay-as-you-go balance</span>
            ) : null}
            {usage.periodEnd ? (
              <span>Included credit resets {formatResetDate(usage.periodEnd)}</span>
            ) : null}
          </div>
          <div>
            <Button
              variant="link"
              onClick={() => void openExternalUrl(services.dashboardBillingUrl)}
            >
              {usage.level === "ok" || usage.walletBalanceCents === null
                ? "Manage billing"
                : "Add credit"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
