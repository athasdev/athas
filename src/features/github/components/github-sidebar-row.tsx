import { type DragEventHandler, type MouseEventHandler, type ReactNode, useCallback } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import { SidebarListItem } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

type PreviewBadgeTone = "default" | "accent" | "success" | "warning" | "error" | "muted";

export interface GitHubSidebarPreviewBadge {
  label: ReactNode;
  tone?: PreviewBadgeTone;
}

interface GitHubSidebarPreviewDetail {
  label: ReactNode;
  value?: ReactNode;
  mono?: boolean;
  className?: string;
  onClick?: () => void;
  actionLabel?: string;
}

interface GitHubSidebarPreview {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  badges?: GitHubSidebarPreviewBadge[];
  details?: GitHubSidebarPreviewDetail[];
  footer?: ReactNode;
}

interface GitHubSidebarRowProps {
  title: ReactNode;
  description?: ReactNode;
  leading: ReactNode;
  trailing?: ReactNode;
  active?: boolean;
  preview?: GitHubSidebarPreview;
  className?: string;
  draggable?: boolean;
  onClick: () => void;
  onContextMenu?: MouseEventHandler<HTMLElement>;
  onDragStart?: DragEventHandler<HTMLElement>;
  onPrefetch?: () => void;
}

function previewBadgeClassName(tone: PreviewBadgeTone = "default") {
  switch (tone) {
    case "accent":
      return "bg-primary/12 text-primary";
    case "success":
      return "bg-success/12 text-success";
    case "warning":
      return "bg-warning/12 text-warning";
    case "error":
      return "bg-destructive/12 text-destructive";
    case "muted":
      return "bg-accent/70 text-subtle-foreground";
    default:
      return "bg-background text-subtle-foreground";
  }
}

export function GitHubSidebarRow({
  active = false,
  className,
  description,
  draggable = false,
  leading,
  onClick,
  onContextMenu,
  onDragStart,
  onPrefetch,
  preview,
  title,
  trailing,
}: GitHubSidebarRowProps) {
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) onPrefetch?.();
    },
    [onPrefetch],
  );

  const row = (
    <SidebarListItem
      active={active}
      leading={
        <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden">
          {leading}
        </span>
      }
      description={description}
      trailing={trailing}
      className={cn("group/github-row", className)}
      draggable={draggable}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onFocus={onPrefetch}
      onMouseEnter={onPrefetch}
      onPointerDown={onPrefetch}
    >
      {title}
    </SidebarListItem>
  );

  if (!preview) {
    return row;
  }

  return (
    <HoverCard onOpenChange={handleOpenChange}>
      <HoverCardTrigger delay={360} closeDelay={120} render={row} />
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={10}
        collisionPadding={10}
        className="z-10080 w-84 overflow-hidden p-0"
      >
        <div className="border-border/70 border-b p-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {preview.icon ? (
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-background">
                {preview.icon}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 font-medium text-foreground ui-text-base">
                {preview.title}
              </div>
              {preview.subtitle ? (
                <div className="mt-1 truncate text-subtle-foreground ui-text-sm">
                  {preview.subtitle}
                </div>
              ) : null}
            </div>
          </div>
          {preview.badges?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {preview.badges.map((badge, index) => (
                <span
                  key={index}
                  className={cn(
                    "inline-flex h-5 max-w-full items-center rounded-full px-1.5 leading-none ui-text-sm",
                    previewBadgeClassName(badge.tone),
                  )}
                >
                  <span className="truncate">{badge.label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {preview.details?.length ? (
          <dl className="grid grid-cols-[5.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 ui-text-sm">
            {preview.details.map((detail, index) =>
              detail.value ? (
                <div key={index} className="contents">
                  <dt className="text-subtle-foreground">{detail.label}</dt>
                  <dd className="min-w-0 truncate text-foreground">
                    {detail.onClick ? (
                      <button
                        type="button"
                        aria-label={detail.actionLabel}
                        className={cn(
                          "-mx-1 -my-0.5 max-w-full truncate rounded px-1 py-0.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                          detail.mono && "font-mono",
                          detail.className,
                        )}
                        onClick={detail.onClick}
                      >
                        {detail.value}
                      </button>
                    ) : (
                      <span className={cn(detail.mono && "font-mono", detail.className)}>
                        {detail.value}
                      </span>
                    )}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        ) : null}
        {preview.footer ? (
          <div className="border-border/70 border-t px-3 py-2 text-subtle-foreground ui-text-sm">
            {preview.footer}
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
