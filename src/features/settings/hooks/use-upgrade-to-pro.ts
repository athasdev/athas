import { useUIState } from "@/features/window/stores/ui-state-store";

export function useUpgradeToPro() {
  const openSettingsDialog = useUIState((state) => state.openSettingsDialog);

  const promptUpgrade = () => {
    openSettingsDialog("account");
  };

  return { promptUpgrade };
}
