import type { Settings } from "@/features/settings/types/settings.types";

type UiRootPreferences = Pick<Settings, "reduceMotion" | "showStatusBar" | "windowChromeDensity">;

export function getUiRootAttributes(settings: UiRootPreferences) {
  return {
    "data-reduce-motion": settings.reduceMotion ? "true" : "system",
    "data-status-bar": settings.showStatusBar ? "visible" : "hidden",
    "data-window-chrome-density": settings.windowChromeDensity,
  } as const;
}

export function shouldShowTabCloseButton(
  visibility: Settings["tabCloseButtonVisibility"],
  isActive: boolean,
  isPinned: boolean,
) {
  return isPinned || visibility === "always" || (visibility === "active" && isActive);
}
