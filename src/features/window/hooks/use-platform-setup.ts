import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { isMac } from "@/utils/platform";

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
