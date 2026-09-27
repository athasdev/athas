import { openUrl } from "@tauri-apps/plugin-opener";
import { getServiceUrls } from "@/config/services";
import { getHostedUsageState } from "@/features/ai/lib/hosted-usage";
import { useProFeature } from "@/features/window/hooks/use-pro-feature";
import { useSubscriptionRefresh } from "@/features/window/hooks/use-subscription-refresh";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Button } from "@/ui/button";
import { SparkleIcon } from "@/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Progress, ProgressCircle, ProgressLabel, ProgressValue } from "@/ui/progress";
import { SidebarIconButton } from "@/ui/sidebar";

const creditFormatter = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const resetDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const USAGE_REFRESH_INTERVAL_MS = 3 * 60 * 1000;

function formatCredits(cents: number) {
  return creditFormatter.format(cents / 100);
}

/**
 * The bottom of the agents sidebar: on Pro, a usage ring whose card shows this period's hosted AI
 * credits on hover or click; otherwise an upgrade prompt.
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
          onClick={() => void openUrl(services.pricingUrl)}
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
          tooltip="Athas Pro usage"
          aria-label="Open Athas Pro usage"
          onClick={() => void openUrl(services.dashboardBillingUrl)}
        >
          <SparkleIcon />
        </SidebarIconButton>
      </div>
    );
  }

  const exhausted = usage.level === "exhausted" || usage.level === "included_exhausted";
  const tone = usage.level === "exhausted" ? "error" : usage.level === "ok" ? "accent" : "warning";
  const resetLabel = usage.periodEnd
    ? `Resets ${resetDateFormatter.format(usage.periodEnd)}`
    : null;
  const remainingLabel = exhausted
    ? "Included usage used up"
    : `${formatCredits(usage.remainingCents)} left`;

  return (
    <div className="shrink-0 px-chrome-inline py-2">
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={200}
          render={
            <SidebarIconButton
              aria-label={`Athas Intelligence usage: ${usage.usedPercent}% used, ${remainingLabel}`}
            />
          }
        >
          <ProgressCircle value={usage.usedPercent} tone={tone} />
        </PopoverTrigger>
        <PopoverContent side="top" align="start" size="default">
          <Progress
            value={usage.usedPercent}
            tone={tone}
            aria-label="Athas Intelligence credits used"
          >
            <ProgressLabel>Usage</ProgressLabel>
            <ProgressValue>{() => remainingLabel}</ProgressValue>
          </Progress>
          <div className="flex min-w-0 flex-col gap-0.5 text-subtle-foreground">
            <span>
              {formatCredits(usage.usedCents)} of {formatCredits(usage.allowanceCents)} used
            </span>
            {usage.pendingCents > 0 ? (
              <span>{formatCredits(usage.pendingCents)} in progress</span>
            ) : null}
            {usage.walletBalanceCents !== null ? (
              <span>{formatCredits(usage.walletBalanceCents)} prepaid balance</span>
            ) : null}
            {resetLabel ? <span>{resetLabel}</span> : null}
          </div>
          <div>
            <Button variant="link" onClick={() => void openUrl(services.dashboardBillingUrl)}>
              {exhausted ? "Top up" : "Details"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
