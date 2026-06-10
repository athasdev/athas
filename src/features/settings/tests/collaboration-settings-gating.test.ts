import { describe, expect, it } from "vite-plus/test";
import type { SettingsTab } from "@/features/window/stores/ui-state.store";
import { resolveSettingsAccess, resolveVisibleSettingsSection } from "../lib/settings-access";
import { filterVisibleSettingsTabs } from "../lib/settings-tab-visibility";

const tabs = [
  { id: "general" },
  { id: "account" },
  { id: "collaboration" },
  { id: "enterprise" },
] satisfies Array<{ id: SettingsTab }>;

function visibleIds(params: {
  canShowEnterpriseSettings?: boolean;
  canShowCollaborationSettings?: boolean;
  matchingTabs?: Set<SettingsTab> | null;
}) {
  return filterVisibleSettingsTabs(tabs, {
    canShowEnterpriseSettings: params.canShowEnterpriseSettings ?? false,
    canShowCollaborationSettings: params.canShowCollaborationSettings ?? false,
    matchingTabs: params.matchingTabs,
  }).map((tab) => tab.id);
}

describe("settings collaboration gating", () => {
  it("hides Collaboration settings without collaboration settings access", () => {
    expect(visibleIds({ canShowCollaborationSettings: false })).not.toContain("collaboration");
  });

  it("shows Collaboration settings when the server snapshot enables it", () => {
    expect(visibleIds({ canShowCollaborationSettings: true })).toContain("collaboration");
  });

  it("still honors settings search visibility after access gating", () => {
    expect(
      visibleIds({
        canShowCollaborationSettings: true,
        matchingTabs: new Set<SettingsTab>(["collaboration"]),
      }),
    ).toEqual(["collaboration"]);
    expect(
      visibleIds({
        canShowCollaborationSettings: false,
        matchingTabs: new Set<SettingsTab>(["collaboration"]),
      }),
    ).toEqual([]);
  });

  it("derives settings access from the server subscription snapshot", () => {
    expect(
      resolveSettingsAccess({
        enterprise: { has_access: true },
        collaboration: { enabled: true },
      }),
    ).toEqual({
      canShowEnterpriseSettings: true,
      canShowCollaborationSettings: true,
    });
  });

  it("falls back to General when a hidden settings tab is requested", () => {
    const access = resolveSettingsAccess(null);

    expect(resolveVisibleSettingsSection("enterprise", access)).toBe("general");
    expect(resolveVisibleSettingsSection("collaboration", access)).toBe("general");
    expect(resolveVisibleSettingsSection("language", access)).toBe("editor");
  });
});
