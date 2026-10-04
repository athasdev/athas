import type { Settings, UiDensity } from "@/features/settings/types/settings.types";

type UiRootPreferences = Pick<Settings, "reduceMotion"> & Partial<Pick<Settings, "uiDensity">>;

export function normalizeUiDensity(value: unknown): UiDensity {
  return value === "comfortable" ? "comfortable" : "compact";
}

export function getUiRootAttributes(settings: UiRootPreferences) {
  return {
    "data-reduce-motion": settings.reduceMotion ? "true" : "system",
    "data-ui-density": normalizeUiDensity(settings.uiDensity),
  } as const;
}

export function shouldShowTabCloseButton(
  visibility: Settings["tabCloseButtonVisibility"],
  isActive: boolean,
  isPinned: boolean,
) {
  return isPinned || visibility === "always" || (visibility === "active" && isActive);
}
