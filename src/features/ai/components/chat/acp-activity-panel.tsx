import { AlertCircle, CheckCircle2, Clock3, ShieldAlert, Wrench } from "lucide-react";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import { cn } from "@/utils/cn";
import { groupAcpActivity } from "@/features/ai/lib/acp-activity-groups";

interface AcpActivityPanelProps {
  events: ChatAcpEvent[];
}

function ActivityPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-full border border-border/60 bg-primary-bg/70 px-2 py-1 text-[10px] text-text-lighter">
      <span className="opacity-70">{label}</span>
      <span className="ml-1 text-text">{value}</span>
    </div>
  );
}

function EventRow({ event }: { event: ChatAcpEvent }) {
  const Icon =
    event.kind === "tool"
      ? Wrench
      : event.kind === "permission"
        ? ShieldAlert
        : event.state === "error"
          ? AlertCircle
          : event.state === "running"
            ? Clock3
            : CheckCircle2;

  return (
    <div className="flex items-start gap-2 rounded-xl border border-border/50 bg-primary-bg/55 px-2.5 py-2">
      <Icon
        size={12}
        className={cn(
          "mt-0.5 shrink-0",
          event.state === "error" && "text-red-400/80",
          event.state === "running" && "animate-spin text-text-lighter/70",
          event.state === "success" && "text-green-400/75",
          (!event.state || event.state === "info") && "text-text-lighter/70",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-text text-xs">{event.label}</div>
        {event.detail ? (
          <div className="mt-0.5 break-words text-[11px] text-text-lighter">{event.detail}</div>
        ) : null}
      </div>
    </div>
  );
}

export function AcpActivityPanel({ events }: AcpActivityPanelProps) {
  const grouped = groupAcpActivity(events);
  if (events.length === 0) return null;

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-border/70 bg-secondary-bg/35 p-3 backdrop-blur-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-lighter/80">
            ACP Activity
          </div>
          <div className="mt-1 text-xs text-text-lighter">
            Live agent operations, permissions, mode changes, and failures.
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ActivityPill label="Tools" value={grouped.counts.tools} />
          <ActivityPill label="Permissions" value={grouped.counts.permissions} />
          <ActivityPill label="Errors" value={grouped.counts.errors} />
        </div>
      </div>

      {grouped.running.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 text-[11px] font-medium text-text-lighter/80">Running now</div>
          <div className="grid gap-2 md:grid-cols-2">
            {grouped.running.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        </div>
      )}

      {grouped.recent.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 text-[11px] font-medium text-text-lighter/80">Recent activity</div>
          <div className="space-y-2">
            {grouped.recent.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
