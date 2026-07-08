import {
  ArrowCounterClockwiseIcon as ArrowCounterClockwise,
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  BugBeetleIcon as BugBeetle,
  DatabaseIcon as Database,
  ListBulletsIcon as ListBullets,
  PuzzlePieceIcon as PuzzlePiece,
  TerminalWindowIcon as TerminalWindow,
  TrashIcon as Trash,
  UsersThreeIcon as UsersThree,
  WarningCircleIcon as WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useMemo } from "react";
import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { chromeItemWrapper } from "@/features/layout/components/chrome-control-styles";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { NotificationsTrigger } from "@/features/notifications/components/notifications-trigger";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import {
  FOOTER_LEADING_ITEM_IDS,
  FOOTER_TRAILING_ITEM_IDS,
  normalizeItemOrder,
  type FooterLeadingItemId,
  type FooterTrailingItemId,
} from "@/features/layout/config/item-order";
import { orderFooterItems, type FooterItem } from "./footer-items";
import { useFooterGitBranchItem } from "./footer-git-branch-item";
import { FooterControlBadge, FooterTabControl } from "./footer-tab-control";
import { useFooterUpdateItem } from "./footer-update-item";

const DEBUGGER_FOOTER_ITEM_ID: FooterLeadingItemId = "debugger";

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
  const updateSetting = useSettingsStore((state) => state.updateSetting);
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
  const isDiagnosticsBufferActive = useBufferStore((state) => {
    if (!state.activeBufferId) return false;
    return state.buffers.some(
      (buffer) => buffer.id === state.activeBufferId && buffer.type === "diagnostics",
    );
  });
  const openDiagnosticsBuffer = useBufferStore.use.actions().openDiagnosticsBuffer;
  const openExtensionsBuffer = useBufferStore.use.actions().openExtensionsBuffer;
  const isExtensionsBufferActive = useBufferStore((state) => {
    if (!state.activeBufferId) return false;
    return state.buffers.some(
      (buffer) => buffer.id === state.activeBufferId && buffer.type === "extensions",
    );
  });
  const branchItem = useFooterGitBranchItem();
  const updateItem = useFooterUpdateItem();
  const debuggerContextMenu = useContextMenu<"debugger">();

  const debuggerBreakpointsCount = useDebuggerStore((state) => state.breakpoints.length);
  const debuggerWatchExpressionsCount = useDebuggerStore((state) => state.watchExpressions.length);
  const debuggerTranscriptCount = useDebuggerStore(
    (state) => state.adapterMessages.length + state.adapterOutput.length,
  );
  const debuggerActions = useDebuggerStore.use.actions();
  const extensionUpdatesCount = useExtensionStore.use.extensionsWithUpdates().size;
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const diagnosticsCount = Array.from(diagnosticsByFile.values()).reduce(
    (total, diagnostics) => total + diagnostics.length,
    0,
  );
  const normalizedFooterLeadingOrder = useMemo<FooterLeadingItemId[]>(() => {
    return normalizeItemOrder(
      footerLeadingItemsOrder,
      FOOTER_LEADING_ITEM_IDS,
    ) as FooterLeadingItemId[];
  }, [footerLeadingItemsOrder]);
  const debuggerFooterIndex = normalizedFooterLeadingOrder.indexOf(DEBUGGER_FOOTER_ITEM_ID);
  const openDebuggerPane = useCallback(() => {
    setBottomPaneActiveTab("debugger");
    setIsBottomPaneVisible(true);
  }, [setBottomPaneActiveTab, setIsBottomPaneVisible]);
  const toggleDebuggerPane = useCallback(() => {
    const showingDebugger = isBottomPaneVisible && bottomPaneActiveTab === "debugger";
    if (showingDebugger) {
      setIsBottomPaneVisible(false);
      return;
    }

    openDebuggerPane();
  }, [bottomPaneActiveTab, isBottomPaneVisible, openDebuggerPane, setIsBottomPaneVisible]);
  const moveDebuggerFooterItem = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = normalizedFooterLeadingOrder.indexOf(DEBUGGER_FOOTER_ITEM_ID);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= normalizedFooterLeadingOrder.length) {
        return;
      }

      const nextOrder = [...normalizedFooterLeadingOrder];
      const [debuggerItem] = nextOrder.splice(currentIndex, 1);
      if (!debuggerItem) return;

      nextOrder.splice(nextIndex, 0, debuggerItem);
      void updateSetting("footerLeadingItemsOrder", nextOrder);
    },
    [normalizedFooterLeadingOrder, updateSetting],
  );
  const resetFooterOrder = useCallback(() => {
    void updateSetting("footerLeadingItemsOrder", [...FOOTER_LEADING_ITEM_IDS]);
  }, [updateSetting]);
  const debuggerContextMenuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        id: "toggle-debugger",
        label:
          isBottomPaneVisible && bottomPaneActiveTab === "debugger"
            ? "Hide Run and Debug"
            : "Show Run and Debug",
        icon: <BugBeetle />,
        onClick: toggleDebuggerPane,
      },
      {
        id: "debugger-actions-separator",
        label: "",
        onClick: () => {},
        separator: true,
      },
      {
        id: "clear-breakpoints",
        label: "Clear Breakpoints",
        icon: <Trash />,
        disabled: debuggerBreakpointsCount === 0,
        onClick: debuggerActions.clearBreakpoints,
      },
      {
        id: "clear-watch-expressions",
        label: "Clear Watch Expressions",
        icon: <Trash />,
        disabled: debuggerWatchExpressionsCount === 0,
        onClick: debuggerActions.clearWatchExpressions,
      },
      {
        id: "clear-debug-console",
        label: "Clear Debug Console",
        icon: <Trash />,
        disabled: debuggerTranscriptCount === 0,
        onClick: debuggerActions.clearAdapterTranscript,
      },
      {
        id: "debugger-footer-separator",
        label: "",
        onClick: () => {},
        separator: true,
      },
      {
        id: "move-debugger-left",
        label: "Move Left",
        icon: <ArrowLeft />,
        disabled: debuggerFooterIndex <= 0,
        onClick: () => moveDebuggerFooterItem(-1),
      },
      {
        id: "move-debugger-right",
        label: "Move Right",
        icon: <ArrowRight />,
        disabled:
          debuggerFooterIndex < 0 || debuggerFooterIndex >= normalizedFooterLeadingOrder.length - 1,
        onClick: () => moveDebuggerFooterItem(1),
      },
      {
        id: "reset-footer-order",
        label: "Reset Footer Order",
        icon: <ArrowCounterClockwise />,
        onClick: resetFooterOrder,
      },
    ],
    [
      bottomPaneActiveTab,
      debuggerActions.clearAdapterTranscript,
      debuggerActions.clearBreakpoints,
      debuggerActions.clearWatchExpressions,
      debuggerBreakpointsCount,
      debuggerFooterIndex,
      debuggerTranscriptCount,
      debuggerWatchExpressionsCount,
      isBottomPaneVisible,
      moveDebuggerFooterItem,
      normalizedFooterLeadingOrder.length,
      resetFooterOrder,
      toggleDebuggerPane,
    ],
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
              onClick={toggleDebuggerPane}
              onContextMenu={(event) => debuggerContextMenu.open(event, "debugger")}
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
              active={isExtensionsBufferActive}
              tone="accent"
              onClick={() => openExtensionsBuffer()}
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
                  openSidebarView("outline");
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
                  openSidebarView("collaboration");
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
    <>
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
      <ContextMenu
        isOpen={debuggerContextMenu.isOpen}
        position={debuggerContextMenu.position}
        items={debuggerContextMenuItems}
        onClose={debuggerContextMenu.close}
      />
    </>
  );
};

export default Footer;
