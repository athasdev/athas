import { useSystemAccessibility } from "@/features/settings/hooks/use-system-accessibility";
import { useFontLoading } from "@/features/settings/hooks/use-font-loading";
import { useNativeMenuState } from "@/features/window/hooks/use-native-menu-state";
import { useSettingsSync } from "@/features/settings/hooks/use-settings-sync";
import { useIntelligenceSettingsSync } from "@/features/ai/intelligence/hooks/use-intelligence-settings-sync";
import { useBootstrapPhaseReached } from "../stores/bootstrap-phase.store";

function SettingsDependentBootstrap() {
  useIntelligenceSettingsSync();
  useSettingsSync();
  useFontLoading();
  useNativeMenuState();
  useSystemAccessibility();
  return null;
}

/**
 * Mounts the startup hooks that read settings once, or push them to native or remote state, only
 * after the saved settings load, so none of them acts on the defaults.
 */
export function SettingsReadyBootstrap() {
  const settingsReady = useBootstrapPhaseReached("settings-ready");
  return settingsReady ? <SettingsDependentBootstrap /> : null;
}
