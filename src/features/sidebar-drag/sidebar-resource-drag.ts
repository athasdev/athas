import type { GitFile } from "@/features/git/types/git-types";

export const SIDEBAR_RESOURCE_MIME = "application/x-athas-sidebar-resource";
export const SIDEBAR_RESOURCE_DROP_ON_AI_EVENT = "athas-sidebar-resource-drop-on-ai";

export type SidebarDragResource =
  | {
      type: "file";
      path: string;
      name: string;
      isDir: boolean;
    }
  | {
      type: "git-file-diff";
      repoPath: string;
      filePath: string;
      staged: boolean;
      status: GitFile["status"];
      name: string;
    }
  | {
      type: "git-commit";
      repoPath: string;
      commitHash: string;
      message?: string;
      author?: string;
      date?: string;
      name: string;
    }
  | {
      type: "git-worktree";
      path: string;
      branch?: string;
      name: string;
    }
  | {
      type: "github-pr";
      repoPath?: string;
      number: number;
      title: string;
      authorAvatarUrl?: string;
      name: string;
    }
  | {
      type: "github-issue";
      repoPath?: string;
      number: number;
      title: string;
      authorAvatarUrl?: string;
      url?: string;
      name: string;
    }
  | {
      type: "github-action";
      repoPath?: string;
      runId: number;
      title: string;
      url?: string;
      name: string;
    };

export const getSidebarResourceLabel = (resource: SidebarDragResource): string => {
  switch (resource.type) {
    case "file":
      return resource.name || resource.path;
    case "git-file-diff":
      return resource.name || resource.filePath;
    case "git-commit":
      return resource.name || resource.commitHash.slice(0, 7);
    case "git-worktree":
      return resource.name || resource.path;
    case "github-pr":
      return `#${resource.number} ${resource.title}`;
    case "github-issue":
      return `#${resource.number} ${resource.title}`;
    case "github-action":
      return resource.title || `Run #${resource.runId}`;
  }
};

export const writeSidebarResourceDragData = (
  dataTransfer: DataTransfer,
  resource: SidebarDragResource,
): void => {
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(SIDEBAR_RESOURCE_MIME, JSON.stringify(resource));
  dataTransfer.setData("text/plain", getSidebarResourceLabel(resource));
};

export const readSidebarResourceDragData = (
  dataTransfer: DataTransfer,
): SidebarDragResource | null => {
  if (!dataTransfer.types.includes(SIDEBAR_RESOURCE_MIME)) {
    return null;
  }

  try {
    return JSON.parse(dataTransfer.getData(SIDEBAR_RESOURCE_MIME)) as SidebarDragResource;
  } catch {
    return null;
  }
};

export const hasSidebarResourceDragData = (dataTransfer: DataTransfer): boolean =>
  dataTransfer.types.includes(SIDEBAR_RESOURCE_MIME);

export const dispatchSidebarResourceDropOnAI = (resource: SidebarDragResource): void => {
  window.dispatchEvent(
    new CustomEvent(SIDEBAR_RESOURCE_DROP_ON_AI_EVENT, {
      detail: { resource },
    }),
  );
};
