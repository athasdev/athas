import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect } from "react";

export function useRemoteWindowClose() {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const remoteParam = urlParams.get("remote");

    if (!remoteParam) return;

    let unlistenCloseRequested: (() => void) | null = null;

    const setupCloseListener = async () => {
      try {
        const currentWindow = getCurrentWebviewWindow();

        unlistenCloseRequested = await currentWindow.onCloseRequested(async (event) => {
          event.preventDefault();

          try {
            await invoke("ssh_disconnect_only", { connectionId: remoteParam });
            await emit("remote-connection-disconnected", { connectionId: remoteParam });
            await currentWindow.destroy();
          } catch (error) {
            console.error("Failed to cleanup on window close:", error);
            await currentWindow.destroy();
          }
        });
      } catch (error) {
        console.error("Failed to set up window close listener:", error);
      }
    };

    setupCloseListener();

    return () => {
      unlistenCloseRequested?.();
    };
  }, []);
}
