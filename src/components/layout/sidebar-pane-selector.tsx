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
    <div className="flex gap-1 p-2 border-b border-[var(--border-color)]">
      <Button
        onClick={() => onViewChange("files")}
        variant="ghost"
        size="sm"
        data-active={isFilesActive}
        className={`text-xs flex items-center justify-center w-8 h-8 rounded ${
          isFilesActive
            ? "bg-[var(--hover-color)] text-[var(--text-color)]"
            : "hover:bg-[var(--hover-color)]"
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
          className={`text-xs flex items-center justify-center w-8 h-8 rounded ${
            isSearchViewActive
              ? "bg-[var(--hover-color)] text-[var(--text-color)]"
              : "hover:bg-[var(--hover-color)]"
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
          className={`text-xs flex items-center justify-center w-8 h-8 rounded ${
            isGitViewActive
              ? "bg-[var(--hover-color)] text-[var(--text-color)]"
              : "hover:bg-[var(--hover-color)]"
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
          className={`text-xs flex items-center justify-center w-8 h-8 rounded ${
            isRemoteViewActive
              ? "bg-[var(--hover-color)] text-[var(--text-color)]"
              : "hover:bg-[var(--hover-color)]"
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
        className="text-xs flex items-center justify-center w-8 h-8 rounded hover:bg-[var(--hover-color)]"
        title="Extensions"
      >
        <Package size={14} />
      </Button>
    </div>
  );
};
