import { useLayoutEffect } from "react";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { applyPlatformClass } from "@/utils/platform";

export function usePlatformSetup() {
  const { cleanup } = useEditorAppStore.use.actions();

  useLayoutEffect(() => {
    applyPlatformClass();

    return () => {
      cleanup();
    };
  }, [cleanup]);
}
