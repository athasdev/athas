import { create } from "zustand";
import type {
  CloudWorkspaceController,
  CloudWorkspaceState,
} from "@/features/web-workbench/services/cloud-workspace-controller";
import type { WebsiteAccount, WebsiteApi } from "@/features/web-workbench/services/website-api";
import { createSelectors } from "@/utils/zustand-selectors";

interface WebAppServices {
  api: WebsiteApi;
  controller: CloudWorkspaceController;
}

interface WebAppState {
  /** Null until the website has answered who is signed in. */
  account: WebsiteAccount | null;
  accountError: string | null;
  cloud: CloudWorkspaceState;
  actions: {
    refreshAccount: () => Promise<void>;
    openRepository: (repo: string, branch: string) => Promise<void>;
    stopWorkspace: () => Promise<void>;
    signOut: () => Promise<void>;
  };
}

let services: WebAppServices | null = null;

function requireServices() {
  if (!services) throw new Error("The web app is not configured.");
  return services;
}

/** The website API the web app was started with, for components that list repositories. */
export function getWebsiteApi() {
  return requireServices().api;
}

const useWebAppStoreBase = create<WebAppState>()((set) => ({
  account: null,
  accountError: null,
  cloud: { phase: "idle", workspace: null, error: null },
  actions: {
    refreshAccount: async () => {
      try {
        const account = await requireServices().api.getAccount();
        set({ account, accountError: null });
      } catch (error) {
        set((state) => ({
          // Keep what is known; a failed check is not a sign-out.
          account: state.account ?? { status: "signed-out" },
          accountError:
            error instanceof Error ? error.message : "Your account could not be loaded.",
        }));
      }
    },
    openRepository: (repo, branch) => requireServices().controller.open(repo, branch),
    stopWorkspace: () => requireServices().controller.stop(),
    signOut: async () => {
      const { api, controller } = requireServices();
      await controller.stop();
      await api.signOut().catch(() => {});
      set({ account: { status: "signed-out" } });
    },
  },
}));

export const useWebAppStore = createSelectors(useWebAppStoreBase);

/** Connects the store to the website API and the cloud workspace controller. */
export function configureWebApp(next: WebAppServices) {
  services = next;
  useWebAppStoreBase.setState({ cloud: next.controller.getState() });
}

export function setCloudWorkspaceState(cloud: CloudWorkspaceState) {
  useWebAppStoreBase.setState({ cloud });
}
