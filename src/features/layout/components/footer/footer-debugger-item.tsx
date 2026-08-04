import { useCallback, useMemo } from "react";
import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import {
  FOOTER_LEADING_ITEM_IDS,
  normalizeItemOrder,
  type FooterLeadingItemId,
} from "@/features/layout/config/item-order";
import type { ChromeItem } from "@/features/layout/utils/chrome-items";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import type { MenuItem } from "@/ui/dropdown";
import { BugIcon, CaretLeftIcon, CaretRightIcon, RefreshIcon, TrashIcon } from "@/ui/icons";
import { FooterTabControl } from "./footer-tab-control";

const ITEM_ID: FooterLeadingItemId = "debugger";

export function useFooterDebuggerItem(
  enabled: boolean,
  configuredOrder: FooterLeadingItemId[],
): ChromeItem<FooterLeadingItemId> | null {
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const setIsBottomPaneVisible = useUIState((state) => state.setIsBottomPaneVisible);
  const setBottomPaneActiveTab = useUIState((state) => state.setBottomPaneActiveTab);
  const breakpointsCount = useDebuggerStore((state) => state.breakpoints.length);
  const watchExpressionsCount = useDebuggerStore((state) => state.watchExpressions.length);
  const transcriptCount = useDebuggerStore(
    (state) => state.adapterMessages.length + state.adapterOutput.length,
  );
  const actions = useDebuggerStore.use.actions();
  const normalizedOrder = useMemo(
    () => normalizeItemOrder(configuredOrder, FOOTER_LEADING_ITEM_IDS) as FooterLeadingItemId[],
    [configuredOrder],
  );
  const itemIndex = normalizedOrder.indexOf(ITEM_ID);

  const togglePane = useCallback(() => {
    if (isBottomPaneVisible && bottomPaneActiveTab === "debugger") {
      setIsBottomPaneVisible(false);
      return;
    }

    setBottomPaneActiveTab("debugger");
    setIsBottomPaneVisible(true);
  }, [bottomPaneActiveTab, isBottomPaneVisible, setBottomPaneActiveTab, setIsBottomPaneVisible]);

  const moveItem = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = normalizedOrder.indexOf(ITEM_ID);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= normalizedOrder.length) return;

      const nextOrder = [...normalizedOrder];
      const [item] = nextOrder.splice(currentIndex, 1);
      if (!item) return;
      nextOrder.splice(nextIndex, 0, item);
      void updateSetting("footerLeadingItemsOrder", nextOrder);
    },
    [normalizedOrder, updateSetting],
  );

  const menuItems = useMemo<MenuItem[]>(
    () => [
      {
        id: "toggle-debugger",
        label:
          isBottomPaneVisible && bottomPaneActiveTab === "debugger"
            ? "Hide Run and Debug"
            : "Show Run and Debug",
        icon: <BugIcon />,
        onClick: togglePane,
      },
      { id: "debugger-actions-separator", label: "", onClick: () => {}, separator: true },
      {
        id: "clear-breakpoints",
        label: "Clear Breakpoints",
        icon: <TrashIcon />,
        disabled: breakpointsCount === 0,
        onClick: actions.clearBreakpoints,
      },
      {
        id: "clear-watch-expressions",
        label: "Clear Watch Expressions",
        icon: <TrashIcon />,
        disabled: watchExpressionsCount === 0,
        onClick: actions.clearWatchExpressions,
      },
      {
        id: "clear-debug-console",
        label: "Clear Debug Console",
        icon: <TrashIcon />,
        disabled: transcriptCount === 0,
        onClick: actions.clearAdapterTranscript,
      },
      { id: "debugger-footer-separator", label: "", onClick: () => {}, separator: true },
      {
        id: "move-debugger-left",
        label: "Move Left",
        icon: <CaretLeftIcon />,
        disabled: itemIndex <= 0,
        onClick: () => moveItem(-1),
      },
      {
        id: "move-debugger-right",
        label: "Move Right",
        icon: <CaretRightIcon />,
        disabled: itemIndex < 0 || itemIndex >= normalizedOrder.length - 1,
        onClick: () => moveItem(1),
      },
      {
        id: "reset-footer-order",
        label: "Reset Footer Order",
        icon: <RefreshIcon />,
        onClick: () => void updateSetting("footerLeadingItemsOrder", [...FOOTER_LEADING_ITEM_IDS]),
      },
    ],
    [
      actions.clearAdapterTranscript,
      actions.clearBreakpoints,
      actions.clearWatchExpressions,
      bottomPaneActiveTab,
      breakpointsCount,
      isBottomPaneVisible,
      itemIndex,
      moveItem,
      normalizedOrder.length,
      togglePane,
      transcriptCount,
      updateSetting,
      watchExpressionsCount,
    ],
  );

  if (!enabled) return null;

  return {
    id: ITEM_ID,
    label: "Run and Debug",
    content: (
      <ContextMenu>
        <ContextMenuTrigger className="contents">
          <FooterTabControl
            tooltip="Toggle Run and Debug"
            active={isBottomPaneVisible && bottomPaneActiveTab === "debugger"}
            commandId="workbench.showDebugger"
            onClick={togglePane}
          >
            <BugIcon />
          </FooterTabControl>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {menuItems.map((item) =>
            item.separator ? (
              <ContextMenuSeparator key={item.id} />
            ) : (
              <ContextMenuItem key={item.id} disabled={item.disabled} onClick={item.onClick}>
                {item.icon}
                {item.label}
              </ContextMenuItem>
            ),
          )}
        </ContextMenuContent>
      </ContextMenu>
    ),
  };
}
