import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import {
  PANE_GROUP_BASE,
  paneHeaderClassName,
  paneIconButtonClassName,
  paneTitleClassName,
} from "@/ui/pane";
import { cn } from "@/utils/cn";

interface GitSidebarSectionHeaderProps {
  title: string;
  actions?: ReactNode;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggle?: () => void;
  icon?: LucideIcon;
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
      <div className={cn(PANE_GROUP_BASE, "min-w-0 flex-1")}>
        {collapsible &&
          (isCollapsed ? (
            <ChevronRight className="size-3.5 shrink-0 text-text-lighter" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-text-lighter" />
          ))}
        {Icon ? <Icon className="size-3.5 shrink-0 text-text-lighter" /> : null}
        <span className={paneTitleClassName()}>{title}</span>
      </div>
      {actions ? <div className={cn(PANE_GROUP_BASE, "shrink-0")}>{actions}</div> : null}
    </>
  );

  if (collapsible) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggle}
        className={cn(
          paneHeaderClassName("w-full shrink-0 justify-between rounded-none px-2.5 hover:bg-hover"),
          className,
        )}
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
