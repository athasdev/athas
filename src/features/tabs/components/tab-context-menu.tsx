import {
  ArrowCounterClockwiseIcon,
  ColumnsIcon,
  CopyIcon,
  FolderOpenIcon,
  LockIcon,
  LockOpenIcon,
  PencilLineIcon,
  PinIcon,
  PinSlashIcon,
  RowsIcon,
  SquareArrowUpIcon,
  TerminalWindowIcon,
} from "@/ui/icons";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { isVirtualContent } from "@/features/panes/types/pane-content.types";
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/ui/context-menu";
import { menuSeparator, type MenuActionItem, type MenuItem } from "@/ui/dropdown";
import { writeClipboardText } from "@/utils/clipboard";
import { getBaseName, getDirName } from "@/utils/path-helpers";
import { IS_MAC } from "@/utils/platform";
import { toast } from "sonner";
import { showSystemSharePicker } from "@/utils/local-files";

interface TabContextMenuProps {
  buffer: PaneContent;
  isPinned?: boolean;
  paneId?: string;
  onPin: (bufferId: string) => void;
  onRename?: (bufferId: string) => void;
  onCloseTab: (bufferId: string) => void;
  onCopyPath?: (path: string) => void;
  onCopyRelativePath?: (path: string) => void;
  onReload?: (bufferId: string) => void;
  onRevealInFinder?: (path: string) => void;
  onSplitRight?: (paneId: string, bufferId: string) => void;
  onSplitDown?: (paneId: string, bufferId: string) => void;
  isPaneLocked?: boolean;
  onTogglePaneLocked?: () => void;
}

const TabContextMenu = ({
  buffer,
  isPinned = false,
  paneId,
  onPin,
  onRename,
  onCloseTab,
  onCopyPath,
  onCopyRelativePath,
  onReload,
  onRevealInFinder,
  onSplitRight,
  onSplitDown,
  isPaneLocked = false,
  onTogglePaneLocked,
}: TabContextMenuProps) => {
  const tabItems: MenuActionItem[] = [
    {
      id: "pin",
      label: isPinned ? "Unpin Tab" : "Pin Tab",
      icon: isPinned ? <PinSlashIcon /> : <PinIcon />,
      onClick: () => onPin(buffer.id),
    },
    ...(buffer.type === "terminal"
      ? [
          {
            id: "rename-terminal",
            label: "Rename",
            icon: <PencilLineIcon />,
            onClick: () => onRename?.(buffer.id),
          },
        ]
      : []),
    ...(paneId && onSplitRight
      ? [
          {
            id: "split-right",
            label: "Split Right",
            icon: <ColumnsIcon />,
            onClick: () => onSplitRight(paneId, buffer.id),
          },
        ]
      : []),
    ...(paneId && onSplitDown
      ? [
          {
            id: "split-down",
            label: "Split Down",
            icon: <RowsIcon />,
            onClick: () => onSplitDown(paneId, buffer.id),
          },
        ]
      : []),
    ...(onTogglePaneLocked
      ? [
          {
            id: "toggle-editor-group-lock",
            label: isPaneLocked ? "Unlock Editor Group" : "Lock Editor Group",
            icon: isPaneLocked ? <LockOpenIcon /> : <LockIcon />,
            onClick: onTogglePaneLocked,
          },
        ]
      : []),
  ];
  const fileItems: MenuActionItem[] = [
    ...(buffer.type === "browser"
      ? [
          {
            id: "copy-address",
            label: "Copy Address",
            icon: <CopyIcon />,
            onClick: async () => {
              try {
                await writeClipboardText(buffer.url);
              } catch (error) {
                console.error("Failed to copy address:", error);
              }
            },
          },
        ]
      : []),
    ...(buffer.type !== "newTab" && buffer.type !== "browser"
      ? [
          {
            id: "copy-path",
            label: "Copy Path",
            icon: <CopyIcon />,
            onClick: async () => {
              if (onCopyPath) {
                onCopyPath(buffer.path);
                return;
              }

              try {
                await writeClipboardText(buffer.path);
              } catch (error) {
                console.error("Failed to copy path:", error);
              }
            },
          },
          {
            id: "copy-relative-path",
            label: "Copy Relative Path",
            icon: <CopyIcon />,
            onClick: () => onCopyRelativePath?.(buffer.path),
          },
          {
            id: "reveal",
            label: "Reveal in Finder",
            icon: <FolderOpenIcon />,
            onClick: () => onRevealInFinder?.(buffer.path),
          },
        ]
      : []),
    ...(!isVirtualContent(buffer) && !buffer.path.includes("://")
      ? [
          ...(IS_MAC
            ? [
                {
                  id: "share",
                  label: "Share…",
                  icon: <SquareArrowUpIcon />,
                  onClick: () => {
                    void showSystemSharePicker(buffer.path).catch((error) => {
                      toast.error(`Unable to share file: ${String(error)}`);
                    });
                  },
                },
              ]
            : []),
          {
            id: "terminal",
            label: "Open in Terminal",
            icon: <TerminalWindowIcon />,
            onClick: () => {
              const dirPath = getDirName(buffer.path);
              const dirName = getBaseName(dirPath, "terminal");
              const { openTerminalBuffer } = useBufferStore.getState().actions;
              openTerminalBuffer({
                name: dirName,
                workingDirectory: dirPath,
              });
            },
          },
        ]
      : []),
    ...(buffer.type !== "extension" && buffer.type !== "newTab"
      ? [
          {
            id: "reload",
            label: "Reload",
            icon: <ArrowCounterClockwiseIcon />,
            onClick: () => onReload?.(buffer.id),
          },
        ]
      : []),
  ];
  const closeItems: MenuActionItem[] = [
    {
      id: "close",
      label: "Close",
      onClick: () => onCloseTab(buffer.id),
    },
    {
      id: "close-others",
      label: "Close Others",
      onClick: () =>
        void keymapRegistry.executeCommand("file.closeOthers", { bufferId: buffer.id }),
    },
    {
      id: "close-right",
      label: "Close to Right",
      onClick: () =>
        void keymapRegistry.executeCommand("file.closeTabsToRight", { bufferId: buffer.id }),
    },
    {
      id: "close-all",
      label: "Close All",
      onClick: () => void keymapRegistry.executeCommand("file.closeAll"),
    },
  ];
  const groups = [tabItems, fileItems, closeItems].filter((group) => group.length > 0);
  const items: MenuItem[] = groups.flatMap((group, index) =>
    index === 0 ? group : [menuSeparator(`sep-${index}`), ...group],
  );

  return (
    <ContextMenuContent>
      {items.map((item) =>
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
  );
};

export default TabContextMenu;
