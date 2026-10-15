import { createContext, type ReactNode, useContext, useState } from "react";
import { formatTokenCount } from "@/features/ai/lib/acp-usage";
import { Button } from "@/ui/button";
import {
  CloudIcon,
  CreditCardIcon,
  GitDiffIcon,
  ListChecksIcon,
  PlayCircleIcon,
  PlugsConnectedIcon,
} from "@/ui/icons";
import {
  formatCreditMicros,
  getRunSpentMicros,
} from "@/features/ai/cloud-agents/services/cloud-environment";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { ProgressCircle } from "@/ui/progress";
import { ScrollArea } from "@/ui/scroll-area";
import { StatusDot } from "@/ui/status-dot";
import { type SessionBoxesData, useSessionBoxes } from "../hooks/use-session-boxes";
import type { SessionAsideLayout } from "../services/session-boxes";
import { useSessionPanel } from "../stores/session-panel.store";
import type { SessionBoxId } from "../types/session-panel.types";
import {
  describeLocation,
  LocationIcon,
  SESSION_BOX_TITLES,
  SessionBoxContent,
} from "./session-box-content";
import { SessionToolCard } from "./session-tool-card";

export const SessionAsideLayoutContext = createContext<SessionAsideLayout>({
  boxes: "hidden",
  tool: "none",
});

function SessionBoxColumn({ chatId }: { chatId: string }) {
  const data = useSessionBoxes(chatId);
  return (
    <ScrollArea
      role="complementary"
      aria-label="Session details"
      data-slot="session-box-column"
      className="w-(--spacing-session-boxes) shrink-0"
    >
      <div className="flex flex-col gap-2 pt-0.5 pr-2 pb-2">
        {data.visible.map((id) => (
          <SessionBoxContent key={id} id={id} chatId={chatId} data={data} placement="column" />
        ))}
      </div>
    </ScrollArea>
  );
}

function railReading(id: SessionBoxId, data: SessionBoxesData): string | null {
  switch (id) {
    case "environment":
      if (data.cloud) return data.cloud.repo ? `Cloud, ${data.cloud.repo}` : "Cloud";
      return data.environment
        ? `${data.environment.name}, ${describeLocation(data.environment.location)}`
        : null;
    case "context":
      return data.context
        ? data.context.percent === null
          ? `${formatTokenCount(data.context.usedTokens)} tokens`
          : `${Math.round(data.context.percent)}% used`
        : null;
    case "changes": {
      if (data.cloud) return data.cloud.run?.prUrl ? "Pull request opened" : "No pull request yet";
      const count = data.changes.files.length;
      return count === 0 ? "No changes yet" : `${count} ${count === 1 ? "file" : "files"}`;
    }
    case "running":
      return data.cloud ? "Sandbox running" : `${data.running.length} running`;
    case "cost":
      return data.cloud?.run ? formatCreditMicros(getRunSpentMicros(data.cloud.run)) : null;
    case "plan":
      return data.plan ? `${data.plan.done} of ${data.plan.entries.length} done` : null;
    case "connectors":
      return `${data.connectors.length} MCP ${data.connectors.length === 1 ? "server" : "servers"}`;
  }
}

function RailIcon({ id, data }: { id: SessionBoxId; data: SessionBoxesData }): ReactNode {
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
      return <PlayCircleIcon />;
    case "cost":
      return <CreditCardIcon />;
    case "plan":
      return <ListChecksIcon />;
    case "connectors":
      return <PlugsConnectedIcon />;
  }
}

/** The boxes folded into their icons; each opens its box beside the rail. */
function SessionBoxRail({ chatId }: { chatId: string }) {
  const data = useSessionBoxes(chatId);
  const [openBox, setOpenBox] = useState<SessionBoxId | null>(null);
  return (
    <div
      role="group"
      aria-label="Session details"
      data-slot="session-box-rail"
      className="flex w-(--spacing-session-rail) shrink-0 flex-col items-center gap-1 pt-0.5 pr-2 pb-2"
    >
      {data.visible.map((id) => {
        const reading = railReading(id, data);
        const label = reading ? `${SESSION_BOX_TITLES[id]}: ${reading}` : SESSION_BOX_TITLES[id];
        return (
          <div key={id} className="relative flex">
            <Popover open={openBox === id} onOpenChange={(open) => setOpenBox(open ? id : null)}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    iconOnly
                    aria-label={label}
                    tooltip={label}
                    data-box={id}
                  />
                }
              >
                <RailIcon id={id} data={data} />
              </PopoverTrigger>
              <PopoverContent
                side="left"
                align="start"
                size="wide"
                onClickCapture={(event) => {
                  if ((event.target as Element).closest("button")) setOpenBox(null);
                }}
              >
                <SessionBoxContent id={id} chatId={chatId} data={data} placement="popover" />
              </PopoverContent>
            </Popover>
            {id === "running" &&
            (data.cloud || data.running.some((item) => item.kind !== "failed")) ? (
              <span className="pointer-events-none absolute top-0.5 right-0.5 flex">
                <StatusDot tone="live" />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface SessionAsideProps {
  chatId: string;
  agentBufferId: string;
  paneId: string | undefined;
  workingDirectory: string | undefined;
}

/**
 * What sits beside a session's conversation: its boxes, stacked or folded into a rail, and the
 * tool a box or the header opened.
 */
export function SessionAside({
  chatId,
  agentBufferId,
  paneId,
  workingDirectory,
}: SessionAsideProps) {
  const layout = useContext(SessionAsideLayoutContext);
  const panel = useSessionPanel(chatId);

  return (
    <>
      {panel.open && layout.tool !== "none" ? (
        <SessionToolCard
          key={chatId}
          chatId={chatId}
          agentBufferId={agentBufferId}
          paneId={paneId}
          workingDirectory={workingDirectory}
          placement={layout.tool}
          beside={layout.boxes === "rail" ? "rail" : "edge"}
        />
      ) : null}
      {layout.boxes === "column" ? <SessionBoxColumn chatId={chatId} /> : null}
      {layout.boxes === "rail" ? <SessionBoxRail chatId={chatId} /> : null}
    </>
  );
}
