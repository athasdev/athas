import { openUrl } from "@tauri-apps/plugin-opener";
import { getServiceUrls } from "@/config/services";
import { ProBadge } from "@/features/window/components/pro-badge";
import { EmptyState } from "@/ui/empty";
import { StackIcon } from "@/ui/icons";

export function ViewsProState({ layout = "default" }: { layout?: "default" | "sidebar" }) {
  return (
    <EmptyState
      layout={layout}
      className={layout === "default" ? "h-full rounded-none bg-background" : undefined}
      icon={<StackIcon />}
      title={
        <span className="flex items-center gap-2">
          Custom Views
          <ProBadge />
        </span>
      }
      message="Turn project data into grouped tables, lists, and boards with Athas Pro."
      action={{
        label: "Upgrade to Pro",
        onClick: () => void openUrl(getServiceUrls().pricingUrl),
        variant: "accent",
      }}
    />
  );
}
