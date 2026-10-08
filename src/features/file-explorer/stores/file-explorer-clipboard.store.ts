import { toast } from "sonner";
import { create } from "zustand";
import {
  commands,
  type ClipboardEntry,
  type FileClipboardState,
  type PastedEntry,
} from "@/bindings/commands";
import { createSelectors } from "@/utils/zustand-selectors";

export type { FileClipboardState };

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
        await commands.clipboardSet(entries, "copy");
        set({ clipboard: { entries, operation: "copy" } });
      } catch (error) {
        reportClipboardError("copy", error);
      }
    },
    cut: async (entries: ClipboardEntry[]) => {
      try {
        await commands.clipboardSet(entries, "cut");
        set({ clipboard: { entries, operation: "cut" } });
      } catch (error) {
        reportClipboardError("cut", error);
      }
    },
    paste: async (targetDirectory: string) => {
      let result: PastedEntry[] | null = null;
      try {
        result = await commands.clipboardPaste(targetDirectory);
      } catch (error) {
        reportClipboardError("paste", error);
      }
      // Backend updates clipboard state and emits events; sync eagerly. A failed paste
      // may still have copied some entries, so sync then too.
      const clipboard = await commands.clipboardGet().catch(() => null);
      set({ clipboard });
      return result;
    },
    clear: async () => {
      await commands.clipboardClear();
      set({ clipboard: null });
    },
    setClipboard: (state: FileClipboardState | null) => {
      set({ clipboard: state });
    },
  },
}));

export const useFileClipboardStore = createSelectors(useFileClipboardStoreBase);
