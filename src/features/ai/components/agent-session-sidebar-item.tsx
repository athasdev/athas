import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { AgentAttentionDot } from "@/features/ai/components/agent-attention-dot";
import type { ChatAttention } from "@/features/ai/types/chat-attention.types";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import {
  ArchiveIcon,
  ClockIcon,
  CubeIcon,
  DotsIcon,
  FolderIcon,
  GitBranchIcon,
  PencilLineIcon,
  PinIcon,
  PinSlashIcon,
  SparkleIcon,
  TrashIcon,
  WindowExpandIcon,
} from "@/ui/icons";
import { SidebarIconButton, SidebarListActionRow, SidebarListItem } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { formatCompactRelativeDate } from "@/utils/date";

interface AgentSessionSidebarItemProps {
  title: string;
  providerIconId: string;
  createdAt: Date;
  lastActiveAt: Date;
  /** The agent is still writing its latest reply. */
  working?: boolean;
  agentLabel: string;
  modelLabel: string;
  projectName: string;
  workspacePath?: string | null;
  branch?: string | null;
  active?: boolean;
  pinned?: boolean;
  /** What the session is waiting on the user for, if anything. */
  attention?: ChatAttention | null;
  onOpen: () => void;
  onOpenInNewWindow?: () => void;
  actionsDisabled?: boolean;
  onPinChange: (pinned: boolean) => void;
  onArchive: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}

const WEEK_MS = 7 * 86_400_000;

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
      <span className="flex size-4 shrink-0 items-center justify-center text-subtle-foreground">
        {icon}
      </span>
      <dt className="w-14 shrink-0 text-subtle-foreground">{label}</dt>
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
  attention,
  branch,
  createdAt,
  lastActiveAt,
  modelLabel,
  onArchive,
  onOpen,
  onOpenInNewWindow,
  actionsDisabled = false,
  onPinChange,
  onRename,
  onDelete,
  pinned = false,
  projectName,
  providerIconId,
  title,
  workspacePath,
  working = false,
}: AgentSessionSidebarItemProps) {
  const startedAt = agentSessionDateFormatter.format(createdAt);
  const lastActive = formatCompactRelativeDate(lastActiveAt, {
    afterWeek: Date.now() - lastActiveAt.getTime() < WEEK_MS ? "days" : "weeks",
    includeAgo: false,
    justNowLabel: "now",
  });

  return (
    <HoverCard>
      <SidebarListActionRow
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarIconButton
                  disabled={actionsDisabled}
                  tooltip="More actions"
                  aria-label={`More actions for ${title}`}
                />
              }
            >
              <DotsIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onOpenInNewWindow ? (
                <DropdownMenuItem onClick={onOpenInNewWindow}>
                  <WindowExpandIcon />
                  Open in New Window
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => onPinChange(!pinned)}>
                {pinned ? <PinSlashIcon /> : <PinIcon />}
                {pinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
              {onRename ? (
                <DropdownMenuItem onClick={onRename}>
                  <PencilLineIcon />
                  Rename
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={onArchive}>
                <ArchiveIcon />
                Archive
              </DropdownMenuItem>
              {onDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    <TrashIcon />
                    Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        }
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
              trailing={
                attention ? (
                  <AgentAttentionDot attention={attention} />
                ) : working ? (
                  <Spinner label="Agent is working" compact />
                ) : (
                  <span className="text-subtle-foreground ui-text-caption">{lastActive}</span>
                )
              }
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
        size="wide"
        variant="preview"
      >
        <div className="flex min-w-0 items-start gap-3 bg-accent p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <ProviderIcon providerId={providerIconId} size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 font-medium text-foreground ui-text-base">{title}</div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-subtle-foreground ui-text-sm">
              <span className="min-w-0 truncate">
                {working
                  ? "Working now"
                  : `Active ${formatCompactRelativeDate(lastActiveAt, { justNowLabel: "just now" })}`}
              </span>
              {pinned ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-background px-1.5 py-0.5 text-subtle-foreground ring-1 ring-border">
                  <PinIcon className="size-3" />
                  Pinned
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <dl className="flex flex-col gap-1.5 border-border border-t p-3 ui-text-sm">
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
          <MetadataRow
            icon={<ClockIcon className="size-3.5" />}
            label="Started"
            value={startedAt}
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
            className="min-w-0 truncate border-border border-t px-3 py-2 font-mono text-subtle-foreground ui-text-sm"
            title={workspacePath}
            dir="rtl"
          >
            <bdi>{workspacePath}</bdi>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-border border-t bg-surface px-3 py-2 text-subtle-foreground ui-text-sm">
          <span>Click to open</span>
          <span>Double-click for new window</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
