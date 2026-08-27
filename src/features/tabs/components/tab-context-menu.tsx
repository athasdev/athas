import {
  ArrowSquareUpIcon as Share,
  ColumnsIcon as Columns2,
  CopyIcon as Copy,
  FolderOpenIcon as FolderOpen,
  LockIcon as Lock,
  LockOpenIcon as LockOpen,
  PencilSimpleLineIcon as PencilSimpleLine,
  PushPinIcon as Pin,
  PushPinSlashIcon as PinOff,
  ArrowCounterClockwiseIcon as RotateCcw,
  RowsIcon as Rows2,
  TerminalWindowIcon as Terminal,
} from "@/ui/icons";
import { invoke } from "@tauri-apps/api/core";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { isVirtualContent } from "@/features/panes/types/pane-content.types";
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/ui/context-menu";
import { menuSeparator, type MenuActionItem, type MenuItem } from "@/ui/dropdown";
import { writeClipboardText } from "@/utils/clipboard";
import { getBaseName, getDirName } from "@/utils/path-helpers";
import { IS_MAC } from "@/utils/platform";
import { toast } from "sonner";

interface TabContextMenuProps {
  buffer: PaneContent;
  paneId?: string;
  onPin: (bufferId: string) => void;
  onRename?: (bufferId: string) => void;
  onCloseTab: (bufferId: string) => void;
  onCloseOthers: (bufferId: string) => void;
  onCloseAll: () => void;
  onCloseToRight: (bufferId: string) => void;
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
  paneId,
  onPin,
  onRename,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCloseToRight,
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
      label: buffer.isPinned ? "Unpin Tab" : "Pin Tab",
      icon: buffer.isPinned ? <PinOff /> : <Pin />,
      onClick: () => onPin(buffer.id),
    },
    ...(buffer.type === "terminal"
      ? [
          {
            id: "rename-terminal",
            label: "Rename",
            icon: <PencilSimpleLine />,
            onClick: () => onRename?.(buffer.id),
          },
        ]
      : []),
    ...(paneId && onSplitRight
      ? [
          {
            id: "split-right",
            label: "Split Right",
            icon: <Columns2 />,
            onClick: () => onSplitRight(paneId, buffer.id),
          },
        ]
      : []),
    ...(paneId && onSplitDown
      ? [
          {
            id: "split-down",
            label: "Split Down",
            icon: <Rows2 />,
            onClick: () => onSplitDown(paneId, buffer.id),
          },
        ]
      : []),
    ...(onTogglePaneLocked
      ? [
          {
            id: "toggle-editor-group-lock",
            label: isPaneLocked ? "Unlock Editor Group" : "Lock Editor Group",
            icon: isPaneLocked ? <LockOpen /> : <Lock />,
            onClick: onTogglePaneLocked,
          },
        ]
      : []),
  ];
  const fileItems: MenuActionItem[] = [
    ...(buffer.type !== "newTab"
      ? [
          {
            id: "copy-path",
            label: "Copy Path",
            icon: <Copy />,
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
            icon: <Copy />,
            onClick: () => onCopyRelativePath?.(buffer.path),
          },
          {
            id: "reveal",
            label: "Reveal in Finder",
            icon: <FolderOpen />,
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
                  icon: <Share />,
                  onClick: () => {
                    void invoke("show_share_picker", { path: buffer.path }).catch((error) => {
                      toast.error(`Unable to share file: ${String(error)}`);
                    });
                  },
                },
              ]
            : []),
          {
            id: "terminal",
            label: "Open in Terminal",
            icon: <Terminal />,
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
            icon: <RotateCcw />,
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
      onClick: () => onCloseOthers(buffer.id),
    },
    {
      id: "close-right",
      label: "Close to Right",
      onClick: () => onCloseToRight(buffer.id),
    },
    {
      id: "close-all",
      label: "Close All",
      onClick: onCloseAll,
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
