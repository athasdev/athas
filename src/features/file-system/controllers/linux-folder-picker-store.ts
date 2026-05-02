import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface LinuxFolderPickerState {
  isOpen: boolean;
  initialPath: string | null;
  actions: {
    open: (initialPath?: string | null) => Promise<string | null>;
    resolve: (path: string | null) => void;
  };
}

let pendingResolve: ((path: string | null) => void) | null = null;

const useLinuxFolderPickerStoreBase = create<LinuxFolderPickerState>()((set) => ({
  isOpen: false,
  initialPath: null,
  actions: {
    open: (initialPath) => {
      pendingResolve?.(null);

      return new Promise<string | null>((resolve) => {
        pendingResolve = resolve;
        set({
          isOpen: true,
          initialPath: initialPath ?? null,
        });
      });
    },
    resolve: (path) => {
      pendingResolve?.(path);
      pendingResolve = null;
      set({
        isOpen: false,
        initialPath: null,
      });
    },
  },
}));

export const useLinuxFolderPickerStore = createSelectors(useLinuxFolderPickerStoreBase);
