import type { ComponentProps, ReactNode } from "react";
import { ChromeBar, ChromeGroup, ChromeLabel } from "@/ui/chrome";
import { cn } from "@/utils/cn";

interface PaneContentHeaderProps extends Omit<
  ComponentProps<typeof ChromeBar>,
  "children" | "region" | "title"
> {
  leading?: ReactNode;
  title?: ReactNode;
  context?: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
}

function PaneContentHeader({
  leading,
  title,
  context,
  detail,
  actions,
  separated = true,
  className,
  ...props
}: PaneContentHeaderProps) {
  return (
    <ChromeBar
      data-slot="pane-content-header"
      region="content"
      separated={separated}
      className={cn("justify-between", className)}
      {...props}
    >
      <ChromeGroup grow gap="loose" className="overflow-hidden">
        {leading ? (
          <span className="flex shrink-0 items-center [&_svg]:size-3.5">{leading}</span>
        ) : null}
        {context ?? (title ? <ChromeLabel tone="strong">{title}</ChromeLabel> : null)}
        {detail ? (
          <ChromeLabel tone="muted" className="hidden shrink-0 sm:block">
            {detail}
          </ChromeLabel>
        ) : null}
      </ChromeGroup>
      {actions ? (
        <ChromeGroup gap="tight" className="scrollbar-none ml-auto max-w-[70%] overflow-x-auto">
          {actions}
        </ChromeGroup>
      ) : null}
    </ChromeBar>
  );
}

interface PaneContentStatusBarProps extends Omit<
  ComponentProps<typeof ChromeBar>,
  "children" | "region"
> {
  endContent?: ReactNode;
  children?: ReactNode;
}

function PaneContentStatusBar({
  children,
  endContent,
  separated = true,
  className,
  ...props
}: PaneContentStatusBarProps) {
  return (
    <ChromeBar
      data-slot="pane-content-status"
      region="status"
      separated={false}
      className={cn(
        "justify-between overflow-hidden whitespace-nowrap border-t",
        separated ? "border-border/55" : "border-transparent",
        className,
      )}
      {...props}
    >
      <ChromeGroup gap="loose" className="shrink-0">
        {children}
      </ChromeGroup>
      {endContent ? (
        <ChromeGroup grow gap="loose" align="end" className="overflow-hidden">
          {endContent}
        </ChromeGroup>
      ) : null}
    </ChromeBar>
  );
}

export { PaneContentHeader, PaneContentStatusBar };
