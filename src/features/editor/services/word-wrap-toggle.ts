import { isEditorWordWrapEnabled } from "@/features/settings/services/editor-word-wrap";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { Settings } from "@/features/settings/types/settings.types";
import { showToast } from "@/utils/toast";
import { useEditorSettingOverridesStore } from "../stores/editor-setting-overrides.store";

/** Whether the editor wraps lines: an extension's override, else the user's settings. */
export function isWordWrapShown(
  settings: Pick<Settings, "wordWrap" | "horizontalTabScroll">,
  overrideWordWrap: boolean | undefined,
): boolean {
  return overrideWordWrap ?? isEditorWordWrapEnabled(settings);
}

/**
 * Flips what the editor shows. Buffer Carousel always wraps, so turning wrap off while it is on
 * also turns the carousel off; otherwise the toggle would change nothing on screen.
 */
export function toggleShownWordWrap(): void {
  const { settings, actions } = useSettingsStore.getState();
  const { overrides } = useEditorSettingOverridesStore.getState();
  if (!isWordWrapShown(settings, overrides.wordWrap)) {
    void actions.updateSetting("wordWrap", true);
    return;
  }

  void actions.updateSetting("wordWrap", false);
  if (!settings.horizontalTabScroll) return;
  void actions.updateSetting("horizontalTabScroll", false);
  showToast({
    type: "info",
    message: "Buffer Carousel turned off",
    description: "The carousel always wraps lines, so it was turned off to stop wrapping.",
  });
}
