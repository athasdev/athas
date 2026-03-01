import { Folder, GitBranch, GitPullRequest, Search } from "lucide-react";
import type { CoreFeaturesState } from "@/features/settings/types/feature";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import Button from "../../../../ui/button";

interface SidebarPaneSelectorProps {
  isGitViewActive: boolean;
  isSearchViewActive: boolean;
  isGitHubPRsViewActive: boolean;
  coreFeatures: CoreFeaturesState;
  onViewChange: (view: "files" | "git" | "search" | "github-prs") => void;
  compact?: boolean;
}

export const SidebarPaneSelector = ({
  isGitViewActive,
  isSearchViewActive,
  isGitHubPRsViewActive,
  coreFeatures,
  onViewChange,
  compact = false,
}: SidebarPaneSelectorProps) => {
  const isFilesActive = !isGitViewActive && !isSearchViewActive && !isGitHubPRsViewActive;
  const tooltipSide = compact ? "bottom" : "right";
  const getTabClass = (isActive: boolean) =>
    cn(
      "flex items-center justify-center rounded-full p-0 text-xs transition-colors duration-150",
      compact ? "h-6 w-6" : "h-8 w-8",
      isActive ? "bg-hover text-text" : "text-text-lighter hover:bg-hover hover:text-text",
    );

  return (
    <div className={cn("flex items-center gap-1", compact ? "p-0.5" : "p-1")}>
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
          <Folder size={14} />
        </Button>
      </Tooltip>

      {coreFeatures.search && (
        <Tooltip content="Search" side={tooltipSide}>
          <Button
            aria-role="tab"
            aria-selected={isSearchViewActive}
            aria-label="Search"
            onClick={() => onViewChange("search")}
            variant="ghost"
            size="sm"
            data-active={isSearchViewActive}
            className={getTabClass(isSearchViewActive)}
          >
            <Search size={14} />
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
            <GitBranch size={14} />
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
            <GitPullRequest size={14} />
          </Button>
        </Tooltip>
      )}
    </div>
  );
};
