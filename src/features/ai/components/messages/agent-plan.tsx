import Badge from "@/ui/badge";
import { CheckIcon, CircleDottedIcon, ListChecksIcon } from "@/ui/icons";
import { Shimmer } from "@/ui/shimmer";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import type { AcpPlanEntry } from "../../types/acp.types";

/**
 * The agent's ACP plan for this turn. Agents resend the whole plan on every update, so this always
 * shows the latest list: done entries checked and muted, the running one live while streaming.
 */
export function AgentPlan({
  entries,
  isStreaming = false,
}: {
  entries: AcpPlanEntry[];
  isStreaming?: boolean;
}) {
  const done = entries.filter((entry) => entry.status === "completed").length;

  return (
    <section
      aria-label="Agent plan"
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-2 ui-text-sm"
    >
      <header className="flex items-center gap-1.5 text-muted-foreground">
        <ListChecksIcon className="size-3.5 shrink-0" />
        <span className="font-medium text-foreground">Plan</span>
        <span className="ml-auto tabular-nums ui-text-caption">
          {done} of {entries.length} done
        </span>
      </header>
      <ol className="flex min-w-0 flex-col gap-1">
        {entries.map((entry, index) => {
          const running = entry.status === "in_progress";
          return (
            <li
              key={`${index}-${entry.content}`}
              data-status={entry.status}
              className="flex min-w-0 items-start gap-2"
            >
              <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
                {entry.status === "completed" ? (
                  <CheckIcon className="size-3.5 text-success" aria-label="Done" />
                ) : running && isStreaming ? (
                  <Spinner compact label="In progress" />
                ) : (
                  <CircleDottedIcon
                    className="size-3.5 text-subtle-foreground"
                    aria-label={running ? "In progress" : "Pending"}
                  />
                )}
              </span>
              <Shimmer
                active={running && isStreaming}
                className={cn(
                  "min-w-0 flex-1 text-pretty",
                  entry.status === "completed"
                    ? "text-muted-foreground line-through"
                    : "text-foreground",
                )}
              >
                {entry.content}
              </Shimmer>
              {entry.priority === "high" && entry.status !== "completed" ? (
                <Badge tone="warning">High</Badge>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
