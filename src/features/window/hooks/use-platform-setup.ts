import { useEffect } from "react";
import { isMac } from "@/features/file-system/controllers/platform";
import { useAppStore } from "@/stores/app-store";

export function usePlatformSetup() {
  const { cleanup } = useAppStore.use.actions();

  useEffect(() => {
    if (isMac()) {
      document.documentElement.classList.add("platform-macos");
    } else {
      document.documentElement.classList.add("platform-other");
    }

    return () => {
      document.documentElement.classList.remove("platform-macos", "platform-other");
      cleanup();
    };
  }, [cleanup]);
}
