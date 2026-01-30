import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type FileClipboardState, useFileClipboardStore } from "./file-clipboard-store";

let unlistenChanged: UnlistenFn | null = null;
let unlistenCleared: UnlistenFn | null = null;

export async function initializeFileClipboardListener() {
  await cleanupFileClipboardListener();

  const { setClipboard } = useFileClipboardStore.getState().actions;

  unlistenChanged = await listen<FileClipboardState>("file-clipboard-changed", (event) => {
    setClipboard(event.payload);
  });

  unlistenCleared = await listen("file-clipboard-cleared", () => {
    setClipboard(null);
  });
}

export async function cleanupFileClipboardListener() {
  if (unlistenChanged) {
    try {
      unlistenChanged();
    } catch (error) {
      console.error("Error cleaning up clipboard changed listener:", error);
    }
    unlistenChanged = null;
  }

  if (unlistenCleared) {
    try {
      unlistenCleared();
    } catch (error) {
      console.error("Error cleaning up clipboard cleared listener:", error);
    }
    unlistenCleared = null;
  }
}
