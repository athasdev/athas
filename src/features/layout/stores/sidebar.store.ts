import { createStore } from "zustand/vanilla";
import type { GitSidebarItemId } from "@/features/layout/config/item-order";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";

export type GitActivitySection = GitSidebarItemId;
type GitHubActivitySection = "pull-requests" | "issues" | "actions" | "releases" | "deployments";
export type DockerActivitySection = "resources" | "compose" | "project" | "registry";
export type DockerContainerFilter = "all" | "running" | "stopped";

interface SidebarState {
  activePath?: string;
  gitSection: GitActivitySection;
  githubSection: GitHubActivitySection;
  dockerSection: DockerActivitySection;
  /** What the Docker pane filters its resources by, set from its header. */
  dockerQuery: string;
  dockerContainerFilter: DockerContainerFilter;
  actions: {
    updateActivePath: (path: string) => void;
    setGitSection: (section: GitActivitySection) => void;
    setGitHubSection: (section: GitHubActivitySection) => void;
    setDockerSection: (section: DockerActivitySection) => void;
    setDockerQuery: (query: string) => void;
    setDockerContainerFilter: (filter: DockerContainerFilter) => void;
  };
}

const createSidebarStore = () =>
  createStore<SidebarState>()((set) => ({
    activePath: undefined,
    gitSection: "changes",
    githubSection: "pull-requests",
    dockerSection: "resources",
    dockerQuery: "",
    dockerContainerFilter: "all",
    actions: {
      updateActivePath: (path: string) => {
        set({ activePath: path });
      },
      setGitSection: (gitSection) => set({ gitSection }),
      setGitHubSection: (githubSection) => set({ githubSection }),
      setDockerSection: (dockerSection) => set({ dockerSection }),
      setDockerQuery: (dockerQuery) => set({ dockerQuery }),
      setDockerContainerFilter: (dockerContainerFilter) => set({ dockerContainerFilter }),
    },
  }));

export const useSidebarStore = createWorkspaceScopedStore("sidebar", createSidebarStore);
