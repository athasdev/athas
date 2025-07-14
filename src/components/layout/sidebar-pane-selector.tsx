import { Folder, GitBranch, Package, Search, Server } from "lucide-react";
import Button from "../ui/button";

interface SidebarPaneSelectorProps {
  isGitViewActive: boolean;
  isSearchViewActive: boolean;
  isRemoteViewActive: boolean;
  coreFeatures: {
    search: boolean;
    git: boolean;
    remote: boolean;
  };
  onViewChange: (view: "files" | "git" | "search" | "remote") => void;
  onOpenExtensions: () => void;
}

export const SidebarPaneSelector = ({
  isGitViewActive,
  isSearchViewActive,
  isRemoteViewActive,
  coreFeatures,
  onViewChange,
  onOpenExtensions,
}: SidebarPaneSelectorProps) => {
  const isFilesActive = !isGitViewActive && !isSearchViewActive && !isRemoteViewActive;

  return (
    <div className="flex gap-1 border-border border-b p-2">
      <Button
        onClick={() => onViewChange("files")}
        variant="ghost"
        size="sm"
        data-active={isFilesActive}
        className={`flex h-8 w-8 items-center justify-center rounded text-xs ${
          isFilesActive ? "bg-hover text-text" : "hover:bg-hover"
        }`}
        title="File Explorer"
      >
        <Folder size={14} />
      </Button>

      {coreFeatures.search && (
        <Button
          onClick={() => onViewChange("search")}
          variant="ghost"
          size="sm"
          data-active={isSearchViewActive}
          className={`flex h-8 w-8 items-center justify-center rounded text-xs ${
            isSearchViewActive ? "bg-hover text-text" : "hover:bg-hover"
          }`}
          title="Search"
        >
          <Search size={14} />
        </Button>
      )}

      {coreFeatures.git && (
        <Button
          onClick={() => onViewChange("git")}
          variant="ghost"
          size="sm"
          data-active={isGitViewActive}
          className={`flex h-8 w-8 items-center justify-center rounded text-xs ${
            isGitViewActive ? "bg-hover text-text" : "hover:bg-hover"
          }`}
          title="Git Source Control"
        >
          <GitBranch size={14} />
        </Button>
      )}

      {coreFeatures.remote && (
        <Button
          onClick={() => onViewChange("remote")}
          variant="ghost"
          size="sm"
          data-active={isRemoteViewActive}
          className={`flex h-8 w-8 items-center justify-center rounded text-xs ${
            isRemoteViewActive ? "bg-hover text-text" : "hover:bg-hover"
          }`}
          title="Remote Connections"
        >
          <Server size={14} />
        </Button>
      )}

      <Button
        onClick={onOpenExtensions}
        variant="ghost"
        size="sm"
        className="flex h-8 w-8 items-center justify-center rounded text-xs hover:bg-hover"
        title="Extensions"
      >
        <Package size={14} />
      </Button>
    </div>
  );
};
