import { useEffect } from "react";
import { useEditorAppStore } from "@/features/editor/stores/editor-app-store";
import { isMac } from "@/utils/platform";

export function usePlatformSetup() {
  const { cleanup } = useEditorAppStore.use.actions();

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
