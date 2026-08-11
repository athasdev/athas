import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import {
  ArchiveIcon,
  CubeIcon,
  FolderIcon,
  GitBranchIcon,
  PushPinIcon,
  SparkleIcon,
} from "@/ui/icons";
import { cn } from "@/utils/cn";

export interface AgentSessionSidebarItemProps {
  title: string;
  providerIconId: string;
  createdAt: Date;
  agentLabel: string;
  modelLabel: string;
  projectName: string;
  workspacePath?: string | null;
  branch?: string | null;
  active?: boolean;
  pinned?: boolean;
  onOpen: () => void;
  onPinChange: (pinned: boolean) => void;
  onArchive: () => void;
}

const agentSessionDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function MetadataRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1rem_4.25rem_minmax(0,1fr)] items-center gap-2">
      <span className="flex size-4 items-center justify-center text-subtle-foreground">{icon}</span>
      <dt className="text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-foreground">{value}</dd>
    </div>
  );
}

export function AgentSessionSidebarItem({
  active = false,
  agentLabel,
  branch,
  createdAt,
  modelLabel,
  onArchive,
  onOpen,
  onPinChange,
  pinned = false,
  projectName,
  providerIconId,
  title,
  workspacePath,
}: AgentSessionSidebarItemProps) {
  const formattedDate = agentSessionDateFormatter.format(createdAt);

  return (
    <HoverCard>
      <div
        className={cn(
          "group/agent-session relative flex min-h-6 w-full min-w-0 items-center rounded-md",
          active && "bg-accent text-foreground",
        )}
      >
        <HoverCardTrigger
          delay={320}
          closeDelay={140}
          onClick={onOpen}
          render={
            <button
              type="button"
              className={cn(
                "flex min-h-6 w-full min-w-0 items-center gap-2 rounded-md py-1 pr-12 pl-2 text-left text-subtle-foreground ui-text-sm transition-colors",
                "hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none",
                active && "text-foreground",
              )}
            />
          }
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <ProviderIcon providerId={providerIconId} size={16} />
          </span>
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </HoverCardTrigger>

        <span className="pointer-events-none absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/agent-session:pointer-events-auto group-hover/agent-session:opacity-100 group-focus-within/agent-session:pointer-events-auto group-focus-within/agent-session:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            active={pinned}
            className="size-5"
            aria-pressed={pinned}
            tooltip={pinned ? "Unpin session" : "Pin session"}
            tooltipSide="top"
            onClick={(event) => {
              event.stopPropagation();
              onPinChange(!pinned);
            }}
          >
            <PushPinIcon className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-5 hover:text-destructive"
            tooltip="Archive session"
            tooltipSide="top"
            onClick={(event) => {
              event.stopPropagation();
              onArchive();
            }}
          >
            <ArchiveIcon className="size-3" />
          </Button>
        </span>
      </div>

      <HoverCardContent
        side="right"
        align="start"
        sideOffset={10}
        collisionPadding={10}
        className="z-10080 w-72 overflow-hidden p-0"
      >
        <div className="border-border/70 border-b p-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background">
              <ProviderIcon providerId={providerIconId} size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 font-medium text-foreground ui-text-base">{title}</div>
              <div className="mt-1 text-subtle-foreground ui-text-sm">{formattedDate}</div>
            </div>
          </div>
        </div>

        <dl className="space-y-2 p-3 ui-text-sm">
          <MetadataRow
            icon={<SparkleIcon className="size-3.5" />}
            label="Agent"
            value={agentLabel}
          />
          <MetadataRow icon={<CubeIcon className="size-3.5" />} label="Model" value={modelLabel} />
          <MetadataRow
            icon={<FolderIcon className="size-3.5" />}
            label="Project"
            value={projectName}
          />
          {branch ? (
            <MetadataRow
              icon={<GitBranchIcon className="size-3.5" />}
              label="Branch"
              value={branch}
            />
          ) : null}
        </dl>

        {workspacePath ? (
          <div
            className="truncate border-border/70 border-t px-3 py-2 font-mono text-subtle-foreground ui-text-xs"
            title={workspacePath}
          >
            {workspacePath}
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
