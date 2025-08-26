import { Folder, GitBranch, Package, Search, Server } from "lucide-react";
import type { CoreFeaturesState } from "@/settings/models/feature.types";
import Button from "../ui/button";

interface SidebarPaneSelectorProps {
  isGitViewActive: boolean;
  isSearchViewActive: boolean;
  isRemoteViewActive: boolean;
  isExtensionsViewActive: boolean;
  isRemoteWindow: boolean;
  coreFeatures: CoreFeaturesState;
  onViewChange: (view: "files" | "git" | "search" | "remote" | "extensions") => void;
  onOpenExtensions: () => void;
}

export const SidebarPaneSelector = ({
  isGitViewActive,
  isSearchViewActive,
  isRemoteViewActive,
  isExtensionsViewActive,
  isRemoteWindow,
  coreFeatures,
  onViewChange,
  onOpenExtensions,
}: SidebarPaneSelectorProps) => {
  const isFilesActive =
    !isGitViewActive && !isSearchViewActive && !isRemoteViewActive && !isExtensionsViewActive;

  return (
    <div className="flex gap-0.5 border-border border-b bg-secondary-bg p-1.5">
      <Button
        onClick={() => onViewChange("files")}
        variant="ghost"
        size="sm"
        data-active={isFilesActive}
        className={`flex h-6 w-6 items-center justify-center rounded p-0 text-xs ${
          isFilesActive
            ? "bg-selected text-text"
            : "text-text-lighter hover:bg-hover hover:text-text"
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
          className={`flex h-6 w-6 items-center justify-center rounded p-0 text-xs ${
            isSearchViewActive
              ? "bg-selected text-text"
              : "text-text-lighter hover:bg-hover hover:text-text"
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
          className={`flex h-6 w-6 items-center justify-center rounded p-0 text-xs ${
            isGitViewActive
              ? "bg-selected text-text"
              : "text-text-lighter hover:bg-hover hover:text-text"
          }`}
          title="Git Source Control"
        >
          <GitBranch size={14} />
        </Button>
      )}

      {coreFeatures.remote && !isRemoteWindow && (
        <Button
          onClick={() => onViewChange("remote")}
          variant="ghost"
          size="sm"
          data-active={isRemoteViewActive}
          className={`flex h-6 w-6 items-center justify-center rounded p-0 text-xs ${
            isRemoteViewActive
              ? "bg-selected text-text"
              : "text-text-lighter hover:bg-hover hover:text-text"
          }`}
          title="Remote Connections"
        >
          <Server size={14} />
        </Button>
      )}

      <Button
        onClick={() => {
          onViewChange("extensions");
          onOpenExtensions();
        }}
        variant="ghost"
        size="sm"
        data-active={isExtensionsViewActive}
        className={`flex h-6 w-6 items-center justify-center rounded p-0 text-xs ${
          isExtensionsViewActive
            ? "bg-selected text-text"
            : "text-text-lighter hover:bg-hover hover:text-text"
        }`}
        title="Extensions"
      >
        <Package size={14} />
      </Button>
    </div>
  );
};
