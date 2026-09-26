import { openUrl } from "@tauri-apps/plugin-opener";
import { getServiceUrls } from "@/config/services";
import { useProFeature } from "@/features/window/hooks/use-pro-feature";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Button } from "@/ui/button";
import { SparkleIcon } from "@/ui/icons";
import { Progress, ProgressLabel, ProgressValue } from "@/ui/progress";
import { SidebarFooter } from "@/ui/sidebar";

const creditFormatter = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const resetDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function formatCredits(cents: number) {
  return creditFormatter.format(cents / 100);
}

/**
 * The bottom of the agents sidebar: this period's hosted AI credits on Pro, an upgrade prompt
 * otherwise.
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
      <SidebarFooter>
        <Button
          variant="ghost"
          size="sm"
          width="full"
          align="between"
          onClick={() => void openUrl(services.dashboardBillingUrl)}
        >
          <span>Athas Pro</span>
          <span className="text-subtle-foreground">View usage</span>
        </Button>
      </SidebarFooter>
    );
  }

  const usedPercent = Math.min(
    100,
    Math.max(0, Math.round((credits.usedCents / credits.allowanceCents) * 100)),
  );
  const resetDate = credits.periodEnd ? new Date(credits.periodEnd) : null;

  return (
    <SidebarFooter>
      <div className="flex flex-col gap-1.5 p-2">
        <Progress
          value={usedPercent}
          tone={usedPercent >= 90 ? "warning" : "accent"}
          aria-label="Athas Intelligence credits used"
        >
          <ProgressLabel>Usage</ProgressLabel>
          <ProgressValue>{() => `${formatCredits(credits.remainingCents)} left`}</ProgressValue>
        </Progress>
        <div className="flex min-w-0 items-center justify-between gap-2 text-subtle-foreground">
          <span className="min-w-0 truncate">
            {resetDate && !Number.isNaN(resetDate.getTime())
              ? `Resets ${resetDateFormatter.format(resetDate)}`
              : `${formatCredits(credits.usedCents)} used`}
          </span>
          <Button variant="link" onClick={() => void openUrl(services.dashboardBillingUrl)}>
            Details
          </Button>
        </div>
      </div>
    </SidebarFooter>
  );
}
