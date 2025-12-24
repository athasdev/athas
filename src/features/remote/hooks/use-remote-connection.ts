import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useSidebarStore } from "@/stores/sidebar-store";

export function useRemoteConnection() {
  const setRemoteWindow = useSidebarStore.use.setRemoteWindow();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const remoteParam = urlParams.get("remote");
    if (remoteParam) {
      setRemoteWindow(true, undefined, remoteParam);
    }

    let unlistenRemoteInfo: (() => void) | null = null;

    const setupRemoteListener = async () => {
      try {
        unlistenRemoteInfo = await listen<{
          connectionId: string;
          connectionName: string;
          isRemoteWindow: boolean;
        }>("remote-connection-info", (event) => {
          const { isRemoteWindow, connectionName, connectionId } = event.payload;
          setRemoteWindow(isRemoteWindow, connectionName, connectionId);
        });
      } catch (error) {
        console.error("Failed to set up remote connection listener:", error);
      }
    };

    setupRemoteListener();

    return () => {
      if (unlistenRemoteInfo) {
        unlistenRemoteInfo();
      }
    };
  }, [setRemoteWindow]);
}
