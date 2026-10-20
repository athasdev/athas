import { openExternalUrl } from "@/utils/external-url";
import { getServiceUrls } from "@/config/services";
import { getHostedUsageState } from "@/features/ai/services/hosted-usage";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import { useSubscriptionRefresh } from "@/features/auth/hooks/use-subscription-refresh";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { Button } from "@/ui/button";
import { SparkleIcon } from "@/ui/icons";
import { AthasUsageIndicator } from "../athas-usage-indicator";
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
      <div className="flex shrink-0 items-center">
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
      <div className="flex shrink-0 items-center">
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

  return (
    <div className="flex shrink-0 items-center">
      <AthasUsageIndicator placement="sidebar" />
    </div>
  );
}
