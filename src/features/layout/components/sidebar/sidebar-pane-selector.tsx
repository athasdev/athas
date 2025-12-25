import { Folder, GitBranch, GitPullRequest, Search } from "lucide-react";
import type { CoreFeaturesState } from "@/features/settings/types/feature";
import Tooltip from "@/ui/tooltip";
import Button from "../../../../ui/button";

interface SidebarPaneSelectorProps {
  isGitViewActive: boolean;
  isSearchViewActive: boolean;
  isGitHubPRsViewActive: boolean;
  coreFeatures: CoreFeaturesState;
  onViewChange: (view: "files" | "git" | "search" | "github-prs") => void;
}

export const SidebarPaneSelector = ({
  isGitViewActive,
  isSearchViewActive,
  isGitHubPRsViewActive,
  coreFeatures,
  onViewChange,
}: SidebarPaneSelectorProps) => {
  const isFilesActive = !isGitViewActive && !isSearchViewActive && !isGitHubPRsViewActive;

  return (
    <div className="flex gap-0.5 border-border border-b bg-secondary-bg px-1.5 py-0.5">
      <Tooltip content="File Explorer" side="right">
        <Button
          aria-role="tab"
          aria-selected={isFilesActive}
          aria-label="File Explorer"
          onClick={() => onViewChange("files")}
          variant="ghost"
          size="sm"
          data-active={isFilesActive}
          className={`flex h-6 w-6 items-center justify-center rounded p-0 text-xs ${
            isFilesActive
              ? "bg-selected text-text"
              : "text-text-lighter hover:bg-hover hover:text-text"
          }`}
        >
          <Folder size={14} />
        </Button>
      </Tooltip>

      {coreFeatures.search && (
        <Tooltip content="Search" side="right">
          <Button
            aria-role="tab"
            aria-selected={isSearchViewActive}
            aria-label="Search"
            onClick={() => onViewChange("search")}
            variant="ghost"
            size="sm"
            data-active={isSearchViewActive}
            className={`flex h-6 w-6 items-center justify-center rounded p-0 text-xs ${
              isSearchViewActive
                ? "bg-selected text-text"
                : "text-text-lighter hover:bg-hover hover:text-text"
            }`}
          >
            <Search size={14} />
          </Button>
        </Tooltip>
      )}

      {coreFeatures.git && (
        <Tooltip content="Source Control" side="right">
          <Button
            aria-role="tab"
            aria-selected={isGitViewActive}
            aria-label="Git Source Control"
            onClick={() => onViewChange("git")}
            variant="ghost"
            size="sm"
            data-active={isGitViewActive}
            className={`flex h-6 w-6 items-center justify-center rounded p-0 text-xs ${
              isGitViewActive
                ? "bg-selected text-text"
                : "text-text-lighter hover:bg-hover hover:text-text"
            }`}
          >
            <GitBranch size={14} />
          </Button>
        </Tooltip>
      )}

      {coreFeatures.github && (
        <Tooltip content="Pull Requests" side="right">
          <Button
            aria-role="tab"
            aria-selected={isGitHubPRsViewActive}
            aria-label="GitHub Pull Requests"
            onClick={() => onViewChange("github-prs")}
            variant="ghost"
            size="sm"
            data-active={isGitHubPRsViewActive}
            className={`flex h-6 w-6 items-center justify-center rounded p-0 text-xs ${
              isGitHubPRsViewActive
                ? "bg-selected text-text"
                : "text-text-lighter hover:bg-hover hover:text-text"
            }`}
          >
            <GitPullRequest size={14} />
          </Button>
        </Tooltip>
      )}
    </div>
  );
};
