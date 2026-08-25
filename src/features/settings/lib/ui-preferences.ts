import type { Settings } from "@/features/settings/types/settings.types";

type UiRootPreferences = Pick<Settings, "reduceMotion" | "showStatusBar">;

export function getUiRootAttributes(settings: UiRootPreferences) {
  return {
    "data-reduce-motion": settings.reduceMotion ? "true" : "system",
    "data-status-bar": settings.showStatusBar ? "visible" : "hidden",
  } as const;
}

export function shouldShowTabCloseButton(
  visibility: Settings["tabCloseButtonVisibility"],
  isActive: boolean,
  isPinned: boolean,
) {
  return isPinned || visibility === "always" || (visibility === "active" && isActive);
}
