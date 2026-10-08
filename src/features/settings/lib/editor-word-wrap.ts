import type { Settings } from "@/features/settings/types/settings.types";

/** Horizontal tab scrolling lays buffers side by side, so the editor always wraps in that mode. */
export function isEditorWordWrapEnabled(
  settings: Pick<Settings, "wordWrap" | "horizontalTabScroll">,
): boolean {
  return settings.wordWrap || settings.horizontalTabScroll;
}
