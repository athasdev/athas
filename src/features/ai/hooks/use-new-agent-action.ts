import { useCallback } from "react";
import { useUIState } from "@/features/window/stores/ui-state.store";

export function useNewAgentAction(onOpen?: () => void) {
  const setIsVisible = useUIState((state) => state.setIsAgentLauncherVisible);

  return useCallback(() => {
    onOpen?.();
    setIsVisible(true);
  }, [onOpen, setIsVisible]);
}
