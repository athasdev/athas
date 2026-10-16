import type { ReactNode } from "react";
import { formatTokenCount } from "@/features/ai/lib/acp-usage";
import {
  formatCreditMicros,
  getRunSpentMicros,
} from "@/features/ai/cloud-agents/services/cloud-environment";
import {
  ChevronDownIcon,
  CloudIcon,
  CreditCardIcon,
  GitDiffIcon,
  ListChecksIcon,
  PlayCircleIcon,
  PlugsConnectedIcon,
} from "@/ui/icons";
import { ProgressCircle } from "@/ui/progress";
import { ScrollArea } from "@/ui/scroll-area";
import { StatusDot } from "@/ui/status-dot";
import { cn } from "@/utils/cn";
import { type SessionBoxesData, useSessionBoxes } from "../hooks/use-session-boxes";
import type { SessionBoxId } from "../types/session-panel.types";
import {
  describeLocation,
  LocationIcon,
  SESSION_BOX_TITLES,
  SessionBoxContent,
} from "./session-box-content";

/** The session's boxes, stacked: the dock's content while no tool pane is open. */
export function SessionInfoColumn({ chatId }: { chatId: string }) {
  const data = useSessionBoxes(chatId);
  if (data.visible.length === 0) return null;
  return (
    <ScrollArea
      role="complementary"
      aria-label="Session details"
      data-slot="session-box-column"
      fill="flex"
    >
      <div className="flex flex-col gap-2 px-1 pt-1 pb-2">
        {data.visible.map((id) => (
          <SessionBoxContent key={id} id={id} chatId={chatId} data={data} />
        ))}
      </div>
    </ScrollArea>
  );
}

function readBox(id: SessionBoxId, data: SessionBoxesData): string | null {
  switch (id) {
    case "environment":
      if (data.cloud) return data.cloud.repo ?? "Cloud";
      return data.environment
        ? data.environment.branch
          ? `${data.environment.name} · ${data.environment.branch}`
          : data.environment.name
        : null;
    case "context":
      return data.context
        ? data.context.percent === null
          ? formatTokenCount(data.context.usedTokens)
          : `${Math.round(data.context.percent)}%`
        : null;
    case "changes": {
      if (data.cloud) return data.cloud.run?.prUrl ? "PR" : null;
      const count = data.changes.files.length;
      return count === 0 ? null : `${count} ${count === 1 ? "file" : "files"}`;
    }
    case "running":
      return data.cloud ? "Running" : data.running.length > 0 ? `${data.running.length}` : null;
    case "cost":
      return data.cloud?.run ? formatCreditMicros(getRunSpentMicros(data.cloud.run)) : null;
    case "plan":
      return data.plan ? `${data.plan.done}/${data.plan.entries.length}` : null;
    case "connectors":
      return data.connectors.length > 0 ? `${data.connectors.length}` : null;
  }
}

function BoxIcon({ id, data }: { id: SessionBoxId; data: SessionBoxesData }): ReactNode {
  switch (id) {
    case "environment":
      if (data.cloud) return <CloudIcon />;
      return data.environment ? <LocationIcon location={data.environment.location} /> : null;
    case "context":
      return (
        <ProgressCircle value={data.context?.percent ?? 0} tone={data.context?.tone ?? "accent"} />
      );
    case "changes":
      return <GitDiffIcon />;
    case "running":
      return data.cloud || data.running.some((item) => item.kind !== "failed") ? (
        <span className="flex size-[1em] items-center justify-center">
          <StatusDot tone="live" />
        </span>
      ) : (
        <PlayCircleIcon />
      );
    case "cost":
      return <CreditCardIcon />;
    case "plan":
      return <ListChecksIcon />;
    case "connectors":
      return <PlugsConnectedIcon />;
  }
}

/**
 * The session's details folded into one row above its open tools: a short reading per box, and
 * the switch that unfolds the boxes.
 */
export function SessionInfoSummary({
  chatId,
  expanded,
  onToggle,
}: {
  chatId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const data = useSessionBoxes(chatId);
  const readings = data.visible.flatMap((id) => {
    const reading = readBox(id, data);
    return reading ? [{ id, reading }] : [];
  });
  const label = readings
    .map(({ id, reading }) => `${SESSION_BOX_TITLES[id]}: ${reading}`)
    .join(", ");
  const location =
    data.environment && !data.cloud ? describeLocation(data.environment.location) : null;

  return (
    <button
      type="button"
      data-slot="session-info-summary"
      aria-expanded={expanded}
      aria-label={expanded ? "Fold session details" : `Session details. ${label}`}
      title={location ?? undefined}
      onClick={onToggle}
      className="flex h-pane-header w-full min-w-0 shrink-0 items-center gap-3 rounded-lg px-2 text-left text-muted-foreground ui-text-sm outline-none transition-colors duration-fast ease-smooth hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus [&_svg]:size-[1em] [&_svg]:shrink-0"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        {readings.map(({ id, reading }, index) => (
          <span
            key={id}
            data-box={id}
            className={cn(
              "flex items-center gap-1.5 tabular-nums",
              index === 0 ? "min-w-0 shrink" : "shrink-0",
            )}
          >
            <span className="flex text-subtle-foreground">
              <BoxIcon id={id} data={data} />
            </span>
            <span className="truncate">{reading}</span>
          </span>
        ))}
      </span>
      <ChevronDownIcon
        className={cn(
          "text-subtle-foreground transition-transform duration-fast ease-smooth",
          !expanded && "-rotate-90",
        )}
      />
    </button>
  );
}
