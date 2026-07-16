import { useLayoutEffect } from "react";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { isMac, isWindows } from "@/utils/platform";

export function usePlatformSetup() {
  const { cleanup } = useEditorAppStore.use.actions();

  useLayoutEffect(() => {
    if (isMac()) {
      document.documentElement.classList.add("platform-macos");
    } else {
      document.documentElement.classList.add("platform-other");
      if (isWindows()) {
        document.documentElement.classList.add("platform-windows");
      }
    }

    return () => {
      document.documentElement.classList.remove(
        "platform-macos",
        "platform-other",
        "platform-windows",
      );
      cleanup();
    };
  }, [cleanup]);
}
