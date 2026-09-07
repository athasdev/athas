import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import type { ReactNode } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import { ArchiveIcon, CubeIcon, FolderIcon, GitBranchIcon, PinIcon, SparkleIcon } from "@/ui/icons";
import { SidebarIconButton, SidebarListActionRow, SidebarListItem } from "@/ui/sidebar";
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
  onOpenInNewWindow?: () => void;
  actionsDisabled?: boolean;
  onPinChange: (pinned: boolean) => void;
  onArchive: () => void;
}

const agentSessionDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function MetadataRow({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex size-4 shrink-0 items-center justify-center text-subtle-foreground/70">
        {icon}
      </span>
      <dt className="w-14 shrink-0 text-subtle-foreground/80">{label}</dt>
      <dd
        className={cn("min-w-0 flex-1 truncate text-right text-foreground", mono && "font-mono")}
        title={value}
      >
        {value}
      </dd>
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
  onOpenInNewWindow,
  actionsDisabled = false,
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
      <SidebarListActionRow
        actions={[
          <SidebarIconButton
            key="pin"
            disabled={actionsDisabled}
            active={pinned}
            aria-pressed={pinned}
            tooltip={pinned ? "Unpin session" : "Pin session"}
            onClick={(event) => {
              event.stopPropagation();
              onPinChange(!pinned);
            }}
          >
            <PinIcon />
          </SidebarIconButton>,
          <SidebarIconButton
            key="archive"
            disabled={actionsDisabled}
            tone="danger"
            tooltip="Archive session"
            onClick={(event) => {
              event.stopPropagation();
              onArchive();
            }}
          >
            <ArchiveIcon />
          </SidebarIconButton>,
        ]}
      >
        <HoverCardTrigger
          delay={320}
          closeDelay={140}
          onClick={onOpen}
          onDoubleClick={onOpenInNewWindow}
          render={
            <SidebarListItem
              active={active}
              leading={<ProviderIcon providerId={providerIconId} size={16} />}
            >
              {title}
            </SidebarListItem>
          }
        />
      </SidebarListActionRow>

      <HoverCardContent
        side="right"
        align="start"
        sideOffset={10}
        collisionPadding={10}
        className="z-10080 w-[19rem] overflow-hidden p-0"
      >
        <div className="flex min-w-0 items-start gap-3 bg-[color-mix(in_srgb,var(--accent)_45%,transparent)] p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border/60">
            <ProviderIcon providerId={providerIconId} size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 font-medium text-foreground ui-text-base">{title}</div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-subtle-foreground ui-text-sm">
              <span className="min-w-0 truncate">{formattedDate}</span>
              {pinned ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-background px-1.5 py-0.5 text-subtle-foreground ring-1 ring-border/60">
                  <PinIcon className="size-3" />
                  Pinned
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <dl className="flex flex-col gap-1.5 border-border/60 border-t p-3 ui-text-sm">
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
              mono
            />
          ) : null}
        </dl>

        {workspacePath ? (
          <div
            className="min-w-0 truncate border-border/60 border-t px-3 py-2 font-mono text-subtle-foreground/80 ui-text-sm"
            title={workspacePath}
            dir="rtl"
          >
            <bdi>{workspacePath}</bdi>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-border/60 border-t bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] px-3 py-2 text-subtle-foreground/80 ui-text-sm">
          <span>Click to open</span>
          <span>Double-click for new window</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
