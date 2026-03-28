import {
  Columns2,
  Copy,
  FolderOpen,
  Pin,
  PinOff,
  RotateCcw,
  Rows2,
  Terminal,
  X,
} from "lucide-react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import type { PaneContent } from "@/features/panes/types/pane-content";
import { isVirtualContent } from "@/features/panes/types/pane-content";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import Keybinding from "@/ui/keybinding";
import { IS_MAC } from "@/utils/platform";

interface TabContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  buffer: PaneContent | null;
  paneId?: string;
  onClose: () => void;
  onPin: (bufferId: string) => void;
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
}

const TabContextMenu = ({
  isOpen,
  position,
  buffer,
  paneId,
  onClose,
  onPin,
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
}: TabContextMenuProps) => {
  if (!isOpen || !buffer) return null;

  const closeKeys = [IS_MAC ? "Cmd" : "Ctrl", "W"];
  const items: ContextMenuItem[] = [
    {
      id: "pin",
      label: buffer.isPinned ? "Unpin Tab" : "Pin Tab",
      icon: buffer.isPinned ? <PinOff /> : <Pin />,
      onClick: () => onPin(buffer.id),
    },
    { id: "sep-1", label: "", separator: true, onClick: () => {} },
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
    ...(paneId && (onSplitRight || onSplitDown)
      ? [{ id: "sep-2", label: "", separator: true, onClick: () => {} }]
      : []),
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
          await navigator.clipboard.writeText(buffer.path);
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
    ...(!isVirtualContent(buffer) && !buffer.path.includes("://")
      ? [
          {
            id: "terminal",
            label: "Open in Terminal",
            icon: <Terminal />,
            onClick: () => {
              const dirPath = buffer.path.substring(0, buffer.path.lastIndexOf("/"));
              const dirName = dirPath.split("/").pop() || "terminal";
              const { openTerminalBuffer } = useBufferStore.getState().actions;
              openTerminalBuffer({
                name: dirName,
                workingDirectory: dirPath,
              });
            },
          },
        ]
      : []),
    ...(buffer.path !== "extensions://marketplace"
      ? [
          {
            id: "reload",
            label: "Reload",
            icon: <RotateCcw />,
            onClick: () => onReload?.(buffer.id),
          },
        ]
      : []),
    { id: "sep-3", label: "", separator: true, onClick: () => {} },
    {
      id: "close",
      label: "Close",
      icon: <X />,
      keybinding: <Keybinding keys={closeKeys} className="opacity-60" />,
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

  return <ContextMenu isOpen={isOpen} position={position} items={items} onClose={onClose} />;
};

export default TabContextMenu;
