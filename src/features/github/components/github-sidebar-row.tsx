import { PreviewCard } from "@base-ui/react/preview-card";
import { type DragEventHandler, type MouseEventHandler, type ReactNode, useCallback } from "react";
import { cn } from "@/utils/cn";

type PreviewBadgeTone = "default" | "accent" | "success" | "warning" | "error" | "muted";

export interface GitHubSidebarPreviewBadge {
  label: ReactNode;
  tone?: PreviewBadgeTone;
}

export interface GitHubSidebarPreviewDetail {
  label: ReactNode;
  value?: ReactNode;
  mono?: boolean;
  className?: string;
  onClick?: () => void;
  actionLabel?: string;
}

export interface GitHubSidebarPreview {
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
      return "bg-accent/12 text-accent";
    case "success":
      return "bg-success/12 text-success";
    case "warning":
      return "bg-warning/12 text-warning";
    case "error":
      return "bg-error/12 text-error";
    case "muted":
      return "bg-hover/70 text-text-lighter";
    default:
      return "bg-primary-bg text-text-lighter";
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

  const rowClassName = cn(
    "font-sans group/github-row flex min-h-12 w-full min-w-0 cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left text-text-lighter transition-[background-color,color]",
    "hover:bg-hover/70 hover:text-text focus-visible:bg-hover/70 focus-visible:text-text focus-visible:outline-none",
    active && "bg-hover/80 text-text",
    className,
  );
  const rowContent = (
    <>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center overflow-hidden">
        {leading}
      </span>
      <span className="min-w-0 flex-1">
        <span className="ui-text-base block truncate whitespace-nowrap font-medium leading-5 text-text">
          {title}
        </span>
        {description || trailing ? (
          <span className="ui-text-sm mt-0.5 flex min-w-0 items-center gap-2 leading-4 text-text-lighter">
            <span className="min-w-0 flex-1 truncate whitespace-nowrap">{description}</span>
            {trailing ? (
              <span className="ml-auto flex max-w-[45%] shrink-0 items-center gap-1.5 truncate whitespace-nowrap text-right">
                {trailing}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </>
  );

  if (!preview) {
    return (
      <button
        type="button"
        className={rowClassName}
        draggable={draggable}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        onFocus={onPrefetch}
        onMouseEnter={onPrefetch}
        onPointerDown={onPrefetch}
      >
        {rowContent}
      </button>
    );
  }

  return (
    <PreviewCard.Root onOpenChange={handleOpenChange}>
      <PreviewCard.Trigger
        delay={360}
        closeDelay={120}
        draggable={draggable}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        onFocus={onPrefetch}
        onMouseEnter={onPrefetch}
        onPointerDown={onPrefetch}
        render={<button type="button" className={rowClassName} />}
      >
        {rowContent}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={10}
          className="z-[10080]"
        >
          <PreviewCard.Popup className="font-sans w-[21rem] overflow-hidden rounded-xl border border-border/75 bg-secondary-bg/95 text-text shadow-[var(--shadow-popover)] backdrop-blur-sm transition-[opacity,transform,filter] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] data-[ending-style]:translate-x-1 data-[ending-style]:opacity-0 data-[ending-style]:[filter:blur(2px)] data-[starting-style]:translate-x-1 data-[starting-style]:opacity-0 data-[starting-style]:[filter:blur(2px)]">
            <div className="border-border/70 border-b p-3">
              <div className="flex min-w-0 items-start gap-2.5">
                {preview.icon ? (
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-bg">
                    {preview.icon}
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 font-medium text-text ui-text-base">
                    {preview.title}
                  </div>
                  {preview.subtitle ? (
                    <div className="mt-1 truncate text-text-lighter ui-text-sm">
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
                      <dt className="text-text-lighter">{detail.label}</dt>
                      <dd className="min-w-0 truncate text-text">
                        {detail.onClick ? (
                          <button
                            type="button"
                            aria-label={detail.actionLabel}
                            className={cn(
                              "-mx-1 -my-0.5 max-w-full cursor-pointer truncate rounded px-1 py-0.5 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-none",
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
              <div className="border-border/70 border-t px-3 py-2 text-text-lighter ui-text-sm">
                {preview.footer}
              </div>
            ) : null}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
