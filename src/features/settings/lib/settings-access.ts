import type { SettingsTab } from "@/features/window/stores/ui-state.store";
import type { SettingsSection } from "../types/settings.types";

interface SettingsAccessSubscription {
  enterprise?: {
    has_access?: boolean | null;
  } | null;
  collaboration?: {
    enabled?: boolean | null;
  } | null;
}

export interface SettingsAccess {
  canShowEnterpriseSettings: boolean;
  canShowCollaborationSettings: boolean;
}

export function resolveSettingsAccess(
  subscription: SettingsAccessSubscription | null | undefined,
): SettingsAccess {
  return {
    canShowEnterpriseSettings: subscription?.enterprise?.has_access === true,
    canShowCollaborationSettings: subscription?.collaboration?.enabled === true,
  };
}

export function resolveVisibleSettingsSection(
  tab: SettingsTab,
  access: SettingsAccess,
): SettingsSection {
  if (tab === "language") {
    return "editor";
  }

  if (
    (!access.canShowEnterpriseSettings && tab === "enterprise") ||
    (!access.canShowCollaborationSettings && tab === "collaboration")
  ) {
    return "general";
  }

  return tab;
}
