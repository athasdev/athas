import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

export interface ClipboardEntry {
  path: string;
  is_dir: boolean;
}

export interface FileClipboardState {
  entries: ClipboardEntry[];
  operation: "copy" | "cut";
}

export interface PastedEntry {
  source_path: string;
  destination_path: string;
  is_dir: boolean;
}

interface FileClipboardStore {
  clipboard: FileClipboardState | null;
  actions: {
    copy: (entries: ClipboardEntry[]) => Promise<void>;
    cut: (entries: ClipboardEntry[]) => Promise<void>;
    paste: (targetDirectory: string) => Promise<PastedEntry[]>;
    clear: () => Promise<void>;
    setClipboard: (state: FileClipboardState | null) => void;
  };
}

const useFileClipboardStoreBase = create<FileClipboardStore>()((set) => ({
  clipboard: null,
  actions: {
    copy: async (entries: ClipboardEntry[]) => {
      await invoke("clipboard_set", { entries, operation: "copy" });
      set({ clipboard: { entries, operation: "copy" } });
    },
    cut: async (entries: ClipboardEntry[]) => {
      await invoke("clipboard_set", { entries, operation: "cut" });
      set({ clipboard: { entries, operation: "cut" } });
    },
    paste: async (targetDirectory: string) => {
      const result = await invoke<PastedEntry[]>("clipboard_paste", {
        targetDirectory,
      });
      // Backend updates clipboard state and emits events; sync eagerly
      const clipboard = await invoke<FileClipboardState | null>("clipboard_get");
      set({ clipboard });
      return result;
    },
    clear: async () => {
      await invoke("clipboard_clear");
      set({ clipboard: null });
    },
    setClipboard: (state: FileClipboardState | null) => {
      set({ clipboard: state });
    },
  },
}));

export const useFileClipboardStore = createSelectors(useFileClipboardStoreBase);
