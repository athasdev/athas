import {
  BugBeetleIcon as BugBeetle,
  DatabaseIcon as Database,
  ListBulletsIcon as ListBullets,
  PuzzlePieceIcon as PuzzlePiece,
  TerminalWindowIcon as TerminalWindow,
  UsersThreeIcon as UsersThree,
  WarningCircleIcon as WarningCircle,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { chromeItemWrapper } from "@/features/layout/components/chrome-control-styles";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { NotificationsTrigger } from "@/features/notifications/components/notifications-trigger";
import {
  FOOTER_TRAILING_ITEM_IDS,
  normalizeItemOrder,
  type FooterLeadingItemId,
  type FooterTrailingItemId,
} from "@/features/layout/config/item-order";
import { orderFooterItems, type FooterItem } from "./footer-items";
import { useFooterGitBranchItem } from "./footer-git-branch-item";
import { FooterControlBadge, FooterTabControl } from "./footer-tab-control";
import { useFooterUpdateItem } from "./footer-update-item";

const Footer = () => {
  const terminalEnabled = useSettingsStore((state) => state.settings.coreFeatures.terminal);
  const debuggerEnabled = useSettingsStore((state) => state.settings.coreFeatures.debugger);
  const diagnosticsEnabled = useSettingsStore((state) => state.settings.coreFeatures.diagnostics);
  const outlineEnabled = useSettingsStore((state) => state.settings.coreFeatures.outline);
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
  const openSettingsDialog = useUIState((state) => state.openSettingsDialog);
  const hasTeamsCollaborationAccess = useAuthStore(
    (state) => state.subscription?.collaboration?.enabled === true,
  );
  const isCollaborationFeatureEnabled = hasTeamsCollaborationAccess && teamCollaborationEnabled;
  const { openSidebarView } = useSidebarPaneController();
  const isDiagnosticsBufferActive = useBufferStore((state) => {
    if (!state.activeBufferId) return false;
    return state.buffers.some(
      (buffer) => buffer.id === state.activeBufferId && buffer.type === "diagnostics",
    );
  });
  const openDiagnosticsBuffer = useBufferStore.use.actions().openDiagnosticsBuffer;
  const branchItem = useFooterGitBranchItem();
  const updateItem = useFooterUpdateItem();

  const extensionUpdatesCount = useExtensionStore.use.extensionsWithUpdates().size;
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const diagnosticsCount = Array.from(diagnosticsByFile.values()).reduce(
    (total, diagnostics) => total + diagnostics.length,
    0,
  );

  const footerLeadingItemsSource: Array<FooterItem<FooterLeadingItemId> | null> = [
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
              <TerminalWindow weight="duotone" />
            </FooterTabControl>
          ),
        }
      : null,
    debuggerEnabled
      ? {
          id: "debugger",
          label: "Run and Debug",
          content: (
            <FooterTabControl
              tooltip="Toggle Run and Debug"
              active={isBottomPaneVisible && bottomPaneActiveTab === "debugger"}
              commandId="workbench.showDebugger"
              onClick={() => {
                setBottomPaneActiveTab("debugger");
                const showingDebugger = !isBottomPaneVisible || bottomPaneActiveTab !== "debugger";
                setIsBottomPaneVisible(showingDebugger);
              }}
            >
              <BugBeetle weight="duotone" />
            </FooterTabControl>
          ),
        }
      : null,
    diagnosticsEnabled
      ? {
          id: "diagnostics",
          label: "Diagnostics",
          content: (
            <FooterTabControl
              tooltip={
                diagnosticsCount > 0
                  ? `${diagnosticsCount} diagnostic${diagnosticsCount === 1 ? "" : "s"}`
                  : "Open Diagnostics"
              }
              active={isDiagnosticsBufferActive}
              tone={!isDiagnosticsBufferActive && diagnosticsCount > 0 ? "warning" : "default"}
              commandId="workbench.toggleDiagnostics"
              onClick={() => openDiagnosticsBuffer()}
            >
              <WarningCircle weight="duotone" />
              {diagnosticsCount > 0 && <span className="tabular-nums">{diagnosticsCount}</span>}
            </FooterTabControl>
          ),
        }
      : null,
    extensionUpdatesCount > 0
      ? {
          id: "extensions",
          label: "Extension updates",
          content: (
            <FooterTabControl
              tooltip={`${extensionUpdatesCount} extension update${extensionUpdatesCount === 1 ? "" : "s"} available`}
              tone="accent"
              onClick={() => openSettingsDialog("extensions")}
            >
              <PuzzlePiece weight="duotone" />
              <FooterControlBadge>
                {extensionUpdatesCount > 9 ? "9+" : extensionUpdatesCount}
              </FooterControlBadge>
            </FooterTabControl>
          ),
        }
      : null,
    updateItem,
  ];
  const footerLeadingItems = footerLeadingItemsSource.filter(
    (item): item is FooterItem<FooterLeadingItemId> => item !== null,
  );
  const shouldShowOutline = outlineEnabled;
  const isOutlineActive = isRightSidebarVisible && activeRightSidebarView === "outline";
  const isDatabasesActive = isCommandPaletteVisible && commandPaletteInitialView === "databases";
  const isCollaborationActive = isRightSidebarVisible && activeRightSidebarView === "collaboration";
  const footerTrailingOrder = useMemo<FooterTrailingItemId[]>(() => {
    return normalizeItemOrder(
      footerTrailingItemsOrder,
      FOOTER_TRAILING_ITEM_IDS,
    ) as FooterTrailingItemId[];
  }, [footerTrailingItemsOrder]);

  const footerTrailingItems: Array<FooterItem<FooterTrailingItemId>> = [
    ...(shouldShowOutline
      ? [
          {
            id: "outline" as const,
            label: "Outline",
            content: (
              <FooterTabControl
                tooltip="Outline"
                active={isOutlineActive}
                commandId="workbench.focusOutline"
                onClick={() => {
                  openSidebarView("outline", { triggerSide: "right" });
                }}
              >
                <ListBullets weight="duotone" />
              </FooterTabControl>
            ),
          },
        ]
      : []),
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
          <Database weight="duotone" />
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
                  openSidebarView("collaboration", { triggerSide: "right" });
                }}
              >
                <UsersThree weight="duotone" />
              </FooterTabControl>
            ),
          },
        ]
      : []),
    {
      id: "notifications",
      label: "Notifications",
      content: <NotificationsTrigger />,
    },
  ];

  return (
    <div className="athas-footer-bar relative z-20 flex min-h-8 shrink-0 items-center justify-between bg-secondary-bg/70 px-2.5 py-1 backdrop-blur-sm">
      <div className="ui-font flex items-center gap-1 text-text-lighter">
        {orderFooterItems(footerLeadingItems, footerLeadingItemsOrder).map((item) => (
          <div key={item.id} className={chromeItemWrapper()}>
            {item.content}
          </div>
        ))}
      </div>

      <div className="ui-font flex items-center gap-1 text-text-lighter">
        {orderFooterItems(footerTrailingItems, footerTrailingOrder).map((item) => (
          <div key={item.id} className={chromeItemWrapper()}>
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Footer;
