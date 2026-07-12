import { type Icon as AppIcon } from "@/ui/icons";
import { CaretDownIcon as ChevronDown, CaretRightIcon as ChevronRight } from "@/ui/icons";
import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { SidebarSectionLabel } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

interface GitSidebarSectionHeaderProps {
  title: string;
  actions?: ReactNode;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggle?: () => void;
  icon?: AppIcon;
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
      <SidebarSectionLabel
        className="h-auto flex-1 px-0 ui-text-sm font-medium text-text"
        leading={
          <>
            {collapsible &&
              (isCollapsed ? (
                <ChevronRight className="size-3.5 shrink-0 text-text-lighter" />
              ) : (
                <ChevronDown className="size-3.5 shrink-0 text-text-lighter" />
              ))}
            {Icon ? <Icon className="size-3.5 shrink-0 text-text-lighter" /> : null}
          </>
        }
      >
        {title}
      </SidebarSectionLabel>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </>
  );

  if (collapsible) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={onToggle}
        className={cn(
          "flex min-h-7 w-full shrink-0 items-center justify-between gap-1.5 rounded-none bg-primary-bg px-2.5 py-1 hover:bg-hover",
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
      className={cn(
        "flex min-h-7 shrink-0 items-center justify-between gap-1.5 bg-primary-bg px-2.5 py-1",
        className,
      )}
    >
      {content}
    </div>
  );
};

export default GitSidebarSectionHeader;
