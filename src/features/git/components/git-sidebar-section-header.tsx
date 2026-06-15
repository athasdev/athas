import { type Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import {
  PaneGroup,
  paneHeaderClassName,
  paneIconButtonClassName,
  paneTitleClassName,
} from "@/features/panes/components/pane-chrome";
import { cn } from "@/utils/cn";

interface GitSidebarSectionHeaderProps {
  title: string;
  actions?: ReactNode;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggle?: () => void;
  icon?: PhosphorIcon;
  className?: string;
}

const GitSidebarSectionHeader = ({
  title,
  actions,
  collapsible = false,
  isCollapsed = false,
  onToggle,
  icon: Icon,
  className,
}: GitSidebarSectionHeaderProps) => {
  const content = (
    <>
      <PaneGroup className="min-w-0 flex-1">
        {collapsible &&
          (isCollapsed ? (
            <ChevronRight className="size-3.5 shrink-0 text-text-lighter" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-text-lighter" />
          ))}
        {Icon ? <Icon className="size-3.5 shrink-0 text-text-lighter" /> : null}
        <span className={paneTitleClassName()}>{title}</span>
      </PaneGroup>
      {actions ? <PaneGroup className="shrink-0">{actions}</PaneGroup> : null}
    </>
  );

  if (collapsible) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={onToggle}
        className={cn(
          paneHeaderClassName("w-full shrink-0 justify-between rounded-none px-2.5 hover:bg-hover"),
          className,
        )}
        compact
      >
        {content}
      </Button>
    );
  }

  return (
    <div
      className={cn(paneHeaderClassName("shrink-0 justify-between rounded-none px-2.5"), className)}
    >
      {content}
    </div>
  );
};

export const gitSidebarSectionActionButtonClassName = (className?: string) =>
  cn(paneIconButtonClassName("size-6"), className);

export default GitSidebarSectionHeader;
