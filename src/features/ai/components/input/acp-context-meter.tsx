import { ChromeLabel } from "@/ui/chrome";
import { ProgressCircle } from "@/ui/progress";
import Tooltip from "@/ui/tooltip";
import {
  describeContextUsage,
  formatUsageCost,
  getContextUsagePercent,
  getContextUsageTone,
} from "@/features/ai/lib/acp-usage";
import type { AcpUsageUpdate } from "@/features/ai/types/acp.types";

/** How full the agent's context window is, and what the session cost so far. */
export function AcpContextMeter({ usage }: { usage: AcpUsageUpdate | null }) {
  if (!usage || usage.size <= 0) return null;

  const percent = getContextUsagePercent(usage);
  const description = describeContextUsage(usage);

  return (
    <Tooltip content={description}>
      <span
        role="meter"
        aria-label="Context window"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={description}
        className="flex shrink-0 items-center gap-1 px-1"
      >
        <ProgressCircle value={percent} tone={getContextUsageTone(usage)} />
        {usage.cost ? <ChromeLabel>{formatUsageCost(usage.cost)}</ChromeLabel> : null}
      </span>
    </Tooltip>
  );
}
