// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import { useAuthStore } from "@/features/auth/stores/auth.store";
import type { SubscriptionInfo } from "@/features/auth/services/auth-api";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useSettingsPage } from "../hooks/use-settings-page";
import { useSettingsSearchStore } from "../stores/settings-search.store";
import { useSettingsStore } from "../stores/settings.store";
import type { SearchResult } from "../types/search.types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function renderSettingsPage() {
  const result = {} as { current: ReturnType<typeof useSettingsPage> };
  function Probe() {
    result.current = useSettingsPage();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return { result, unmount: () => act(() => root.unmount()) };
}

const enterpriseSubscription = {
  status: "pro",
  subscription: null,
  enterprise: { has_access: true, is_admin: true, policy: null },
  collaboration: { enabled: false, workspace: null, members: [] },
} as unknown as SubscriptionInfo;

const result = (tab: SearchResult["tab"], id: string, section = "font") =>
  ({ id, tab, section, label: id }) as unknown as SearchResult;

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  useAuthStore.setState({ subscription: null });
  useSettingsSearchStore.setState({ query: "", results: [], selectedResultId: null });
});

afterEach(() => {
  workspaceRuntimeRegistry.resetForTests();
});

describe("useSettingsPage", () => {
  it("opens the requested tab and remembers it", () => {
    const { result: page, unmount } = renderSettingsPage();

    act(() => page.current.selectTab("editor"));

    expect(page.current.activeTab).toBe("editor");
    expect(useUIState.getState().settingsInitialTab).toBe("editor");
    expect(useSettingsStore.getState().settings.lastSettingsTab).toBe("editor");
    unmount();
  });

  it("redirects tabs this account cannot see", () => {
    const { result: page, unmount } = renderSettingsPage();

    act(() => page.current.selectTab("enterprise"));
    expect(page.current.activeTab).toBe("general");
    expect(page.current.canShowEnterpriseSettings).toBe(false);
    expect(page.current.visibleTabs.map((tab) => tab.id)).not.toContain("enterprise");

    act(() => page.current.selectTab("language"));
    expect(page.current.activeTab).toBe("editor");
    unmount();
  });

  it("shows enterprise settings to enterprise accounts", () => {
    useAuthStore.setState({ subscription: enterpriseSubscription });
    const { result: page, unmount } = renderSettingsPage();

    act(() => page.current.selectTab("enterprise"));

    expect(page.current.canShowEnterpriseSettings).toBe(true);
    expect(page.current.canShowCollaborationSettings).toBe(false);
    expect(page.current.activeTab).toBe("enterprise");
    expect(page.current.visibleTabs.map((tab) => tab.id)).toContain("enterprise");
    unmount();
  });

  it("searches settings and opens a result at its section", () => {
    const { result: page, unmount } = renderSettingsPage();

    act(() => page.current.setSearchQuery("font size"));
    expect(page.current.searchQuery).toBe("font size");
    expect(page.current.searchResults.length).toBeGreaterThan(0);

    const target = result("appearance", "appearance.font", "font-size");
    act(() => page.current.openSearchResult(target));

    expect(page.current.activeTab).toBe("appearance");
    expect(page.current.selectedResultId).toBe("appearance.font");
    expect(useUIState.getState().settingsInitialSection).toBe("font-size");
    unmount();
  });

  it("hides and ignores results on tabs the account cannot see", () => {
    useSettingsSearchStore.setState({
      results: [result("enterprise", "enterprise.policy"), result("git", "git.autofetch")],
    });
    const { result: page, unmount } = renderSettingsPage();

    expect(page.current.searchResults.map((item) => item.id)).toEqual(["git.autofetch"]);

    act(() => page.current.openSearchResult(result("enterprise", "enterprise.policy")));
    expect(page.current.selectedResultId).toBeNull();
    unmount();
  });
});
