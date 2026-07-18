import { useLayoutEffect } from "react";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { isMac, isWindows } from "@/utils/platform";

export function usePlatformSetup() {
  const { cleanup } = useEditorAppStore.use.actions();

  useLayoutEffect(() => {
    const platformClass = isMac()
      ? "platform-macos"
      : isWindows()
        ? "platform-windows"
        : "platform-other";
    document.documentElement.classList.add(platformClass);

    return () => {
      document.documentElement.classList.remove(platformClass);
      cleanup();
    };
  }, [cleanup]);
}
