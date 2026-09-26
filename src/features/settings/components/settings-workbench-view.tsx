import { SharingSettings } from "@/features/sharing/components/sharing-settings";
import { useEffect, useRef } from "react";
import { useResponsiveWorkbenchLayout } from "@/features/layout/hooks/use-responsive-workbench-layout";
import { useSettingsPage } from "@/features/settings/hooks/use-settings-page";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getSettingSearchTargetKey } from "@/features/settings/lib/settings-search";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { ChevronDownIcon } from "@/ui/icons";
import { Workbench, WorkbenchContent } from "@/ui/workbench";

import { AdvancedSettings } from "./tabs/advanced-settings";
import { AccountSettings } from "./tabs/account-settings";
import { AISettings } from "./tabs/ai-settings";
import { AppearanceSettings } from "./tabs/appearance-settings";
import { CollaborationSettings } from "./tabs/collaboration-settings";
import { EditorSettings } from "./tabs/editor-settings";
import { EnterpriseSettings } from "./tabs/enterprise-settings";
import { GeneralSettings } from "./tabs/general-settings";
import { GitSettings } from "./tabs/git-settings";
import { KeyboardSettings } from "./tabs/keyboard-settings";
import { FileTreeSettings } from "./tabs/file-tree-settings";
import { NotificationsSettings } from "./tabs/notifications-settings";
import { TerminalSettings } from "./tabs/terminal-settings";

/**
 * The Settings page, opened as a tab in the main view. Its navigation and search live in the
 * workbench sidebar (`SettingsSidebar`); when the sidebar is not showing them, the header offers
 * a page picker instead.
 */
const SettingsWorkbenchView = () => {
  const settingsInitialSection = useUIState((state) => state.settingsInitialSection);
  const settingsNavigationRequestId = useUIState((state) => state.settingsNavigationRequestId);
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const { narrow } = useResponsiveWorkbenchLayout();
  const isSettingsTabActive = useBufferStore(
    (state) =>
      state.buffers.find((buffer) => buffer.id === state.activeBufferId)?.type === "settings",
  );
  const lastSettingsTab = useSettingsStore((state) => state.settings.lastSettingsTab);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const clearSearch = useSettingsStore((state) => state.actions.clearSearch);
  const {
    activeTab,
    visibleTabs,
    selectTab,
    canShowCollaborationSettings,
    canShowEnterpriseSettings,
    searchResults,
    selectedResultId,
  } = useSettingsPage();
  const setIsSettingsPageActive = useUIState((state) => state.setIsSettingsPageActive);
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarShowsNavigation = isSidebarVisible && !narrow && isSettingsTabActive;

  // The sidebar shows Settings' navigation while this page is the active tab.
  useEffect(() => {
    setIsSettingsPageActive(isSettingsTabActive);
    return () => setIsSettingsPageActive(false);
  }, [isSettingsTabActive, setIsSettingsPageActive]);

  // Pages opened directly (openSettings("ai")) become the page Settings reopens on.
  useEffect(() => {
    if (activeTab !== lastSettingsTab) void updateSetting("lastSettingsTab", activeTab);
  }, [activeTab, lastSettingsTab, updateSetting]);

  useEffect(() => () => clearSearch(), [clearSearch]);

  useEffect(() => {
    if (!settingsInitialSection) return;

    const frameId = window.requestAnimationFrame(() => {
      const content = contentRef.current;
      if (!content) return;

      const sectionKey = getSettingSearchTargetKey(settingsInitialSection);
      const section = content.querySelector<HTMLElement>(
        `[data-settings-section-key="${sectionKey}"]`,
      );
      if (!section) return;

      section.scrollIntoView({ block: "start", inline: "nearest" });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTab, settingsInitialSection, settingsNavigationRequestId]);

  useEffect(() => {
    const clearSearchHighlights = () => {
      const content = contentRef.current;
      if (!content) return;

      content
        .querySelectorAll<HTMLElement>("[data-settings-search-active='true']")
        .forEach((element) => element.removeAttribute("data-settings-search-active"));
      content
        .querySelectorAll<HTMLElement>("[data-settings-search-section-active='true']")
        .forEach((element) => element.removeAttribute("data-settings-search-section-active"));
    };

    if (!selectedResultId) {
      clearSearchHighlights();
      return;
    }

    const result = searchResults.find((item) => item.id === selectedResultId);
    if (!result || result.tab !== activeTab) {
      clearSearchHighlights();
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const content = contentRef.current;
      if (!content) return;

      const sectionKey = getSettingSearchTargetKey(result.section);
      const rowKey = getSettingSearchTargetKey(result.label);
      const section = content.querySelector<HTMLElement>(
        `[data-settings-section-key="${sectionKey}"]`,
      );
      const target =
        section?.querySelector<HTMLElement>(`[data-setting-row-key="${rowKey}"]`) ?? section;

      if (!target) return;

      clearSearchHighlights();
      section?.setAttribute("data-settings-search-section-active", "true");
      target.setAttribute("data-settings-search-active", "true");
      target.scrollIntoView({ block: "center", inline: "nearest" });
      target.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTab, selectedResultId, searchResults]);

  useEffect(() => {
    if (!contentRef.current) return;
    contentRef.current.scrollLeft = 0;
  }, [activeTab]);

  const renderTabContent = () => {
    switch (activeTab) {
      case "account":
        return <AccountSettings />;
      case "sharing":
        return <SharingSettings />;
      case "notifications":
        return <NotificationsSettings />;
      case "general":
        return <GeneralSettings />;
      case "editor":
        return <EditorSettings />;
      case "git":
        return <GitSettings />;
      case "appearance":
        return <AppearanceSettings />;
      case "ai":
        return <AISettings />;
      case "keyboard":
        return <KeyboardSettings />;
      case "collaboration":
        return canShowCollaborationSettings ? <CollaborationSettings /> : <GeneralSettings />;
      case "enterprise":
        return canShowEnterpriseSettings ? <EnterpriseSettings /> : <GeneralSettings />;
      case "advanced":
        return <AdvancedSettings />;
      case "terminal":
        return <TerminalSettings />;
      case "file-explorer":
        return <FileTreeSettings />;
      default:
        return <GeneralSettings />;
    }
  };

  const activePanelId = `settings-panel-${activeTab}`;
  const activeTabItem = visibleTabs.find((item) => item.id === activeTab) ?? visibleTabs[0];

  const pagePicker = sidebarShowsNavigation ? null : (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" aria-label="Settings pages" />}>
        {activeTabItem?.label ?? "Settings"}
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={activeTab}
          onValueChange={(value) => selectTab(value as typeof activeTab)}
        >
          {visibleTabs.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuRadioItem key={item.id} value={item.id} closeOnClick>
                <Icon />
                {item.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Workbench>
      <WorkbenchContent
        title={activeTabItem?.label ?? "Settings"}
        description={activeTabItem?.description}
        pinnedHeader
        actions={pagePicker}
        viewportProps={{
          ref: contentRef,
          id: activePanelId,
          role: "region",
          "aria-label": `${activeTabItem?.label ?? "Settings"} settings`,
          "data-settings-content": "",
        }}
      >
        <div className="@container/settings">{renderTabContent()}</div>
      </WorkbenchContent>
    </Workbench>
  );
};

export default SettingsWorkbenchView;
