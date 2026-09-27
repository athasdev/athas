import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
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

interface PastedEntry {
  source_path: string;
  destination_path: string;
  is_dir: boolean;
}

interface FileClipboardStore {
  clipboard: FileClipboardState | null;
  actions: {
    copy: (entries: ClipboardEntry[]) => Promise<void>;
    cut: (entries: ClipboardEntry[]) => Promise<void>;
    paste: (targetDirectory: string) => Promise<PastedEntry[] | null>;
    clear: () => Promise<void>;
    setClipboard: (state: FileClipboardState | null) => void;
  };
}

function reportClipboardError(action: string, error: unknown) {
  console.error(`File ${action} failed:`, error);
  toast.error(`Could not ${action}`, {
    description: error instanceof Error ? error.message : String(error),
  });
}

// Every caller starts these actions from a click or key press without awaiting them,
// so the actions report their own failures instead of rejecting.
const useFileClipboardStoreBase = create<FileClipboardStore>()((set) => ({
  clipboard: null,
  actions: {
    copy: async (entries: ClipboardEntry[]) => {
      try {
        await invoke("clipboard_set", { entries, operation: "copy" });
        set({ clipboard: { entries, operation: "copy" } });
      } catch (error) {
        reportClipboardError("copy", error);
      }
    },
    cut: async (entries: ClipboardEntry[]) => {
      try {
        await invoke("clipboard_set", { entries, operation: "cut" });
        set({ clipboard: { entries, operation: "cut" } });
      } catch (error) {
        reportClipboardError("cut", error);
      }
    },
    paste: async (targetDirectory: string) => {
      let result: PastedEntry[] | null = null;
      try {
        result = await invoke<PastedEntry[]>("clipboard_paste", {
          targetDirectory,
        });
      } catch (error) {
        reportClipboardError("paste", error);
      }
      // Backend updates clipboard state and emits events; sync eagerly. A failed paste
      // may still have copied some entries, so sync then too.
      const clipboard = await invoke<FileClipboardState | null>("clipboard_get").catch(() => null);
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
