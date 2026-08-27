import { useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import {
  FOOTER_TRAILING_ITEM_IDS,
  normalizeItemOrder,
  type FooterLeadingItemId,
  type FooterTrailingItemId,
} from "@/features/layout/config/item-order";
import { orderChromeItems, type ChromeItem } from "@/features/layout/utils/chrome-items";
import { useFooterDebuggerItem } from "./footer-debugger-item";
import { useFooterGitBranchItem } from "./footer-git-branch-item";
import { FooterControlBadge, FooterTabControl } from "./footer-tab-control";
import { DatabaseIcon, ExtensionsIcon, TerminalWindowIcon, UsersThreeIcon } from "@/ui/icons";
import { ChromeBar, ChromeGroup } from "@/ui/chrome";

const Footer = () => {
  const terminalEnabled = useSettingsStore((state) => state.settings.coreFeatures.terminal);
  const debuggerEnabled = useSettingsStore((state) => state.settings.coreFeatures.debugger);
  const teamCollaborationEnabled = useSettingsStore(
    (state) => state.settings.coreFeatures.teamCollaboration,
  );
  const footerLeadingItemsOrder = useSettingsStore(
    (state) => state.settings.footerLeadingItemsOrder,
  );
  const footerTrailingItemsOrder = useSettingsStore(
    (state) => state.settings.footerTrailingItemsOrder,
  );
  const isRightSidebarVisible = useUIState((state) => state.isRightSidebarVisible);
  const activeRightSidebarView = useUIState((state) => state.activeRightSidebarView);
  const isCommandPaletteVisible = useUIState((state) => state.isCommandPaletteVisible);
  const commandPaletteInitialView = useUIState((state) => state.commandPaletteInitialView);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const setIsBottomPaneVisible = useUIState((state) => state.setIsBottomPaneVisible);
  const setBottomPaneActiveTab = useUIState((state) => state.setBottomPaneActiveTab);
  const openCommandPaletteView = useUIState((state) => state.openCommandPaletteView);
  const hasTeamsCollaborationAccess = useAuthStore(
    (state) => state.subscription?.collaboration?.enabled === true,
  );
  const isCollaborationFeatureEnabled = hasTeamsCollaborationAccess && teamCollaborationEnabled;
  const { openSidebarView } = useSidebarPaneController();
  const openExtensionsBuffer = useBufferStore.use.actions().openExtensionsBuffer;
  const isExtensionsBufferActive = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "extensions" || activeBuffer?.type === "extension";
  });
  const branchItem = useFooterGitBranchItem();

  const debuggerItem = useFooterDebuggerItem(debuggerEnabled, footerLeadingItemsOrder);
  const extensionUpdatesCount = useExtensionStore.use.extensionsWithUpdates().size;
  const footerLeadingItemsSource: Array<ChromeItem<FooterLeadingItemId> | null> = [
    branchItem,
    terminalEnabled
      ? {
          id: "terminal",
          label: "Terminal",
          content: (
            <FooterTabControl
              tooltip="Toggle Terminal"
              active={isBottomPaneVisible && bottomPaneActiveTab === "terminal"}
              commandId="workbench.toggleTerminal"
              onClick={() => {
                setBottomPaneActiveTab("terminal");
                const showingTerminal = !isBottomPaneVisible || bottomPaneActiveTab !== "terminal";
                setIsBottomPaneVisible(showingTerminal);
              }}
            >
              <TerminalWindowIcon />
            </FooterTabControl>
          ),
        }
      : null,
    debuggerItem,
    extensionUpdatesCount > 0
      ? {
          id: "extensions",
          label: "Extension updates",
          content: (
            <FooterTabControl
              tooltip={`${extensionUpdatesCount} extension update${extensionUpdatesCount === 1 ? "" : "s"} available`}
              active={isExtensionsBufferActive}
              tone="accent"
              onClick={() => openExtensionsBuffer()}
            >
              <ExtensionsIcon />
              <FooterControlBadge>
                {extensionUpdatesCount > 9 ? "9+" : extensionUpdatesCount}
              </FooterControlBadge>
            </FooterTabControl>
          ),
        }
      : null,
  ];
  const footerLeadingItems = footerLeadingItemsSource.filter(
    (item): item is ChromeItem<FooterLeadingItemId> => item !== null,
  );
  const isDatabasesActive = isCommandPaletteVisible && commandPaletteInitialView === "databases";
  const isCollaborationActive = isRightSidebarVisible && activeRightSidebarView === "collaboration";
  const footerTrailingOrder = useMemo<FooterTrailingItemId[]>(() => {
    return normalizeItemOrder(
      footerTrailingItemsOrder,
      FOOTER_TRAILING_ITEM_IDS,
    ) as FooterTrailingItemId[];
  }, [footerTrailingItemsOrder]);

  const footerTrailingItems: Array<ChromeItem<FooterTrailingItemId>> = [
    {
      id: "databases",
      label: "Databases",
      content: (
        <FooterTabControl
          tooltip="Databases"
          active={isDatabasesActive}
          commandId="database.connect"
          onClick={() => {
            openCommandPaletteView("databases");
          }}
        >
          <DatabaseIcon />
        </FooterTabControl>
      ),
    },
    ...(isCollaborationFeatureEnabled
      ? [
          {
            id: "collaboration" as const,
            label: "Collaboration",
            content: (
              <FooterTabControl
                tooltip="Collaboration"
                active={isCollaborationActive}
                onClick={() => {
                  openSidebarView("collaboration");
                }}
              >
                <UsersThreeIcon />
              </FooterTabControl>
            ),
          },
        ]
      : []),
  ];

  return (
    <ChromeBar
      region="footer"
      className="athas-footer-bar relative z-20 justify-between"
      aria-label="Status bar"
    >
      <ChromeGroup gap="tight">
        {orderChromeItems(footerLeadingItems, footerLeadingItemsOrder).map((item) => (
          <div key={item.id} className="flex min-h-chrome-control items-center">
            {item.content}
          </div>
        ))}
      </ChromeGroup>

      <ChromeGroup gap="tight">
        {orderChromeItems(footerTrailingItems, footerTrailingOrder).map((item) => (
          <div key={item.id} className="flex min-h-chrome-control items-center">
            {item.content}
          </div>
        ))}
      </ChromeGroup>
    </ChromeBar>
  );
};

export default Footer;
