import { createStore } from "zustand/vanilla";
import type { GitSidebarItemId } from "@/features/layout/config/item-order";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";

export type GitActivitySection = GitSidebarItemId;
export type GitHubActivitySection = "pull-requests" | "issues" | "actions";
export type DockerActivitySection = "resources" | "compose" | "project" | "registry";

interface SidebarState {
  activePath?: string;
  gitSection: GitActivitySection;
  githubSection: GitHubActivitySection;
  dockerSection: DockerActivitySection;
  actions: {
    updateActivePath: (path: string) => void;
    setGitSection: (section: GitActivitySection) => void;
    setGitHubSection: (section: GitHubActivitySection) => void;
    setDockerSection: (section: DockerActivitySection) => void;
  };
}

const createSidebarStore = () =>
  createStore<SidebarState>()((set) => ({
    activePath: undefined,
    gitSection: "changes",
    githubSection: "pull-requests",
    dockerSection: "resources",
    actions: {
      updateActivePath: (path: string) => {
        set({ activePath: path });
      },
      setGitSection: (gitSection) => set({ gitSection }),
      setGitHubSection: (githubSection) => set({ githubSection }),
      setDockerSection: (dockerSection) => set({ dockerSection }),
    },
  }));

export const useSidebarStore = createWorkspaceScopedStore("sidebar", createSidebarStore);
