import { create } from "zustand";
import { toast } from "sonner";
import { createSelectors } from "@/utils/zustand-selectors";

export type LspStatus = "disconnected" | "connecting" | "connected" | "error";

interface LspStatusInfo {
  status: LspStatus;
  activeWorkspaces: string[];
  lastError?: string;
  supportedLanguages?: string[];
}

interface LspState {
  lspStatus: LspStatusInfo;
  actions: {
    updateLspStatus: (
      status: LspStatus,
      workspaces?: string[],
      error?: string,
      languages?: string[],
    ) => void;
    setLspError: (error: string) => void;
    clearLspError: () => void;
  };
}

const LSP_ERROR_TOAST_KEY = "lsp-runtime-error";

export const useLspStore = createSelectors(
  create<LspState>()((set) => ({
    lspStatus: {
      status: "disconnected",
      activeWorkspaces: [],
      lastError: undefined,
      supportedLanguages: undefined,
    },
    actions: {
      updateLspStatus: (status, workspaces, error, languages) => {
        set((state) => ({
          lspStatus: {
            ...state.lspStatus,
            status,
            activeWorkspaces: workspaces || state.lspStatus.activeWorkspaces,
            lastError: error || (status === "error" ? state.lspStatus.lastError : undefined),
            supportedLanguages: languages || state.lspStatus.supportedLanguages,
          },
        }));
      },
      setLspError: (error) => {
        toast.error(error, {
          id: LSP_ERROR_TOAST_KEY,
          duration: 8000,
        });
        set((state) => ({
          lspStatus: {
            ...state.lspStatus,
            status: "error",
            lastError: error,
          },
        }));
      },
      clearLspError: () => {
        toast.dismiss(LSP_ERROR_TOAST_KEY);
        set((state) => ({
          lspStatus: {
            ...state.lspStatus,
            lastError: undefined,
            status: state.lspStatus.activeWorkspaces.length > 0 ? "connected" : "disconnected",
          },
        }));
      },
    },
  })),
);
