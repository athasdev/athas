import { describe, expect, it } from "vite-plus/test";
import type { SettingsTab } from "@/features/window/stores/ui-state-store";
import { filterVisibleSettingsTabs } from "../lib/settings-tab-visibility";

const tabs = [
  { id: "general" },
  { id: "account" },
  { id: "collaboration" },
  { id: "enterprise" },
] satisfies Array<{ id: SettingsTab }>;

function visibleIds(params: {
  hasEnterpriseAccess?: boolean;
  hasTeamsAccess?: boolean;
  matchingTabs?: Set<SettingsTab> | null;
}) {
  return filterVisibleSettingsTabs(tabs, {
    hasEnterpriseAccess: params.hasEnterpriseAccess ?? false,
    hasTeamsAccess: params.hasTeamsAccess ?? false,
    matchingTabs: params.matchingTabs,
  }).map((tab) => tab.id);
}

describe("settings collaboration gating", () => {
  it("hides Collaboration settings without Teams access", () => {
    expect(visibleIds({ hasTeamsAccess: false })).not.toContain("collaboration");
  });

  it("shows Collaboration settings when the subscription payload enables it", () => {
    expect(visibleIds({ hasTeamsAccess: true })).toContain("collaboration");
  });

  it("still honors settings search visibility after Teams gating", () => {
    expect(
      visibleIds({
        hasTeamsAccess: true,
        matchingTabs: new Set<SettingsTab>(["collaboration"]),
      }),
    ).toEqual(["collaboration"]);
    expect(
      visibleIds({
        hasTeamsAccess: false,
        matchingTabs: new Set<SettingsTab>(["collaboration"]),
      }),
    ).toEqual([]);
  });
});
