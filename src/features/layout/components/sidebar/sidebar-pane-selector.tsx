import { Folder, GitBranch, GitPullRequest, Search } from "lucide-react";
import type { CoreFeaturesState } from "@/features/settings/types/feature";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import Button from "../../../../ui/button";
import type { SidebarView } from "./sidebar-pane-utils";

interface SidebarPaneSelectorProps {
  isGitViewActive: boolean;
  isGitHubPRsViewActive: boolean;
  coreFeatures: CoreFeaturesState;
  onViewChange: (view: SidebarView) => void;
  onSearchClick?: () => void;
  compact?: boolean;
}

export const SidebarPaneSelector = ({
  isGitViewActive,
  isGitHubPRsViewActive,
  coreFeatures,
  onViewChange,
  onSearchClick,
  compact = false,
}: SidebarPaneSelectorProps) => {
  const isFilesActive = !isGitViewActive && !isGitHubPRsViewActive;
  const tooltipSide = compact ? "bottom" : "right";
  const getTabClass = (isActive: boolean) =>
    cn(
      "flex items-center justify-center rounded-md p-0 text-xs transition-colors duration-150",
      compact ? "h-5 w-5" : "h-8 w-8",
      isActive ? "bg-hover/80 text-text" : "text-text-lighter hover:bg-hover/50 hover:text-text",
    );

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-full border border-border/70 bg-primary-bg/65",
        compact ? "p-0.5" : "p-1",
      )}
    >
      <Tooltip content="File Explorer" side={tooltipSide}>
        <Button
          aria-role="tab"
          aria-selected={isFilesActive}
          aria-label="File Explorer"
          onClick={() => onViewChange("files")}
          variant="ghost"
          size="sm"
          data-active={isFilesActive}
          className={getTabClass(isFilesActive)}
        >
          <Folder size={13} />
        </Button>
      </Tooltip>

      {coreFeatures.search && onSearchClick && (
        <Tooltip content="Search (⇧⌘F)" side={tooltipSide}>
          <Button
            aria-label="Search"
            onClick={onSearchClick}
            variant="ghost"
            size="sm"
            className={getTabClass(false)}
          >
            <Search size={13} />
          </Button>
        </Tooltip>
      )}

      {coreFeatures.git && (
        <Tooltip content="Source Control" side={tooltipSide}>
          <Button
            aria-role="tab"
            aria-selected={isGitViewActive}
            aria-label="Git Source Control"
            onClick={() => onViewChange("git")}
            variant="ghost"
            size="sm"
            data-active={isGitViewActive}
            className={getTabClass(isGitViewActive)}
          >
            <GitBranch size={13} />
          </Button>
        </Tooltip>
      )}

      {coreFeatures.github && (
        <Tooltip content="Pull Requests" side={tooltipSide}>
          <Button
            aria-role="tab"
            aria-selected={isGitHubPRsViewActive}
            aria-label="GitHub Pull Requests"
            onClick={() => onViewChange("github-prs")}
            variant="ghost"
            size="sm"
            data-active={isGitHubPRsViewActive}
            className={getTabClass(isGitHubPRsViewActive)}
          >
            <GitPullRequest size={13} />
          </Button>
        </Tooltip>
      )}
    </div>
  );
};
