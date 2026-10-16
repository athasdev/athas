import { getServiceUrls } from "@/config/services";
import {
  formatResetDate,
  formatUsdCents,
  getHostedUsageHeadline,
  getHostedUsageState,
  getHostedUsageTone,
} from "@/features/ai/services/hosted-usage";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Progress, ProgressCircle, ProgressLabel, ProgressValue } from "@/ui/progress";
import { SidebarIconButton } from "@/ui/sidebar";
import { openExternalUrl } from "@/utils/external-url";

/**
 * A ring showing how much of this period's included Athas credit is used, with a card on hover
 * or click for the details. Renders nothing until there is usage to show.
 */
export function AthasUsageIndicator({ placement }: { placement: "sidebar" | "composer" }) {
  const credits = useAuthStore((state) => state.subscription?.intelligence?.credits ?? null);
  const services = getServiceUrls();
  const usage = getHostedUsageState(credits);
  if (!usage) return null;

  const tone = getHostedUsageTone(usage.level);
  const headline = getHostedUsageHeadline(usage);
  const label = `Athas AI usage: ${usage.usedPercent}% of included credit used, ${headline}`;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        render={
          placement === "sidebar" ? (
            <SidebarIconButton aria-label={label} />
          ) : (
            <Button type="button" variant="ghost" iconOnly aria-label={label} />
          )
        }
      >
        <ProgressCircle value={usage.usedPercent} tone={tone} />
      </PopoverTrigger>
      <PopoverContent side="top" align={placement === "sidebar" ? "start" : "end"} size="default">
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
          <Button variant="link" onClick={() => void openExternalUrl(services.dashboardBillingUrl)}>
            {usage.level === "ok" || usage.walletBalanceCents === null
              ? "Manage billing"
              : "Add credit"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
