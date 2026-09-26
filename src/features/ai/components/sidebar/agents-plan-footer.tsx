import { openUrl } from "@tauri-apps/plugin-opener";
import { getServiceUrls } from "@/config/services";
import { useProFeature } from "@/features/window/hooks/use-pro-feature";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Button } from "@/ui/button";
import { SparkleIcon } from "@/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Progress, ProgressCircle, ProgressLabel, ProgressValue } from "@/ui/progress";
import { SidebarIconButton } from "@/ui/sidebar";

const creditFormatter = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const resetDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function formatCredits(cents: number) {
  return creditFormatter.format(cents / 100);
}

/**
 * The bottom of the agents sidebar: on Pro, a usage ring whose card shows this period's hosted AI
 * credits on hover or click; otherwise an upgrade prompt.
 */
export function AgentsPlanFooter() {
  const { hasIntelligence } = useProFeature();
  const credits = useAuthStore((state) => state.subscription?.intelligence?.credits ?? null);
  const services = getServiceUrls();

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

  if (!credits || credits.allowanceCents <= 0) {
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

  const usedPercent = Math.min(
    100,
    Math.max(0, Math.round((credits.usedCents / credits.allowanceCents) * 100)),
  );
  const tone = usedPercent >= 90 ? "warning" : "accent";
  const resetDate = credits.periodEnd ? new Date(credits.periodEnd) : null;
  const resetLabel =
    resetDate && !Number.isNaN(resetDate.getTime())
      ? `Resets ${resetDateFormatter.format(resetDate)}`
      : null;

  return (
    <div className="shrink-0 px-chrome-inline py-2">
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={200}
          render={
            <SidebarIconButton
              aria-label={`Athas Intelligence usage: ${usedPercent}% used, ${formatCredits(credits.remainingCents)} left`}
            />
          }
        >
          <ProgressCircle value={usedPercent} tone={tone} />
        </PopoverTrigger>
        <PopoverContent side="top" align="start" size="default">
          <Progress value={usedPercent} tone={tone} aria-label="Athas Intelligence credits used">
            <ProgressLabel>Usage</ProgressLabel>
            <ProgressValue>{() => `${formatCredits(credits.remainingCents)} left`}</ProgressValue>
          </Progress>
          <div className="flex min-w-0 flex-col gap-0.5 text-subtle-foreground">
            <span>
              {formatCredits(credits.usedCents)} of {formatCredits(credits.allowanceCents)} used
            </span>
            {resetLabel ? <span>{resetLabel}</span> : null}
          </div>
          <div>
            <Button variant="link" onClick={() => void openUrl(services.dashboardBillingUrl)}>
              Details
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
