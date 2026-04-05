import {
  Clipboard,
  Copy,
  Edit,
  Eye,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  ImageIcon,
  Info,
  Link,
  RefreshCw,
  Scissors,
  Search,
  Terminal,
  Trash,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard-store";
import type { ContextMenuState } from "@/features/file-system/types/app";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";

interface UseFileExplorerContextMenuOptions {
  rootFolderPath?: string;
  onFileSelect: (path: string, isDir: boolean) => void;
  onCreateNewFolderInDirectory?: (directoryPath: string, folderName: string) => void;
  onGenerateImage?: (directoryPath: string) => void;
  onRefreshDirectory?: (path: string) => void;
  onRenamePath?: (path: string, newName?: string) => void;
  onRevealInFinder?: (path: string) => void;
  onUploadFile?: (directoryPath: string) => void;
  onDuplicatePath?: (path: string) => void;
  onDeleteRequested: (candidate: { path: string; isDir: boolean }) => void;
  onStartInlineEditing: (path: string, isFolder: boolean) => void;
  onOpenAllFilesInDirectory: (directoryPath: string) => Promise<void>;
}

export function useFileExplorerContextMenu({
  rootFolderPath,
  onFileSelect,
  onCreateNewFolderInDirectory,
  onGenerateImage,
  onRefreshDirectory,
  onRenamePath,
  onRevealInFinder,
  onUploadFile,
  onDuplicatePath,
  onDeleteRequested,
  onStartInlineEditing,
  onOpenAllFilesInDirectory,
}: UseFileExplorerContextMenuOptions) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const clipboardActions = useFileClipboardStore.getState().actions;
  const clipboard = useFileClipboardStore((state) => state.clipboard);

  const handleContextMenu = useCallback((e: React.MouseEvent, filePath: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();

    let x = e.pageX;
    let y = e.pageY;
    const menuWidth = 250;
    const menuHeight = 400;

    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight;

    setContextMenu({ x, y, path: filePath, isDir });
  }, []);

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenu) return [];

    const items: ContextMenuItem[] = [];

    if (contextMenu.isDir) {
      items.push(
        {
          id: "new-file",
          label: "New File",
          icon: <FilePlus />,
          onClick: () => onStartInlineEditing(contextMenu.path, false),
        },
        {
          id: "new-folder",
          label: "New Folder",
          icon: <FolderPlus />,
          onClick: () => {
            if (onCreateNewFolderInDirectory) onStartInlineEditing(contextMenu.path, true);
          },
        },
        {
          id: "upload-files",
          label: "Upload Files",
          icon: <Upload />,
          onClick: () => onUploadFile?.(contextMenu.path),
        },
        {
          id: "refresh",
          label: "Refresh",
          icon: <RefreshCw />,
          onClick: () => onRefreshDirectory?.(contextMenu.path),
        },
        {
          id: "open-all-files",
          label: "Open All Files",
          icon: <FolderOpen />,
          onClick: () => void onOpenAllFilesInDirectory(contextMenu.path),
        },
        {
          id: "open-terminal",
          label: "Open in Terminal",
          icon: <Terminal />,
          onClick: () => {
            const folderName = contextMenu.path.split("/").pop() || "terminal";
            const { openTerminalBuffer } = useBufferStore.getState().actions;
            openTerminalBuffer({
              name: folderName,
              workingDirectory: contextMenu.path,
            });
          },
        },
        {
          id: "find-in-folder",
          label: "Find in Folder",
          icon: <Search />,
          onClick: () => {},
        },
      );

      if (onGenerateImage) {
        items.push({
          id: "generate-image",
          label: "Generate Image",
          icon: <ImageIcon />,
          onClick: () => onGenerateImage(contextMenu.path),
        });
      }

      items.push({ id: "sep-dir", label: "", separator: true, onClick: () => {} });
    } else {
      items.push(
        {
          id: "open",
          label: "Open",
          icon: <FolderOpen />,
          onClick: () => onFileSelect(contextMenu.path, false),
        },
        {
          id: "copy-content",
          label: "Copy Content",
          icon: <Copy />,
          onClick: async () => {
            try {
              const response = await fetch(contextMenu.path);
              const content = await response.text();
              await navigator.clipboard.writeText(content);
            } catch {}
          },
        },
        {
          id: "duplicate-file",
          label: "Duplicate",
          icon: <FileText />,
          onClick: () => onDuplicatePath?.(contextMenu.path),
        },
        {
          id: "properties",
          label: "Properties",
          icon: <Info />,
          onClick: async () => {
            try {
              const stats = await fetch(`file://${contextMenu.path}`, { method: "HEAD" });
              const size = stats.headers.get("content-length") || "Unknown";
              const fileName = contextMenu.path.split("/").pop() || "";
              const extension = fileName.includes(".") ? fileName.split(".").pop() : "No extension";
              alert(
                `File: ${fileName}\nPath: ${contextMenu.path}\nSize: ${size} bytes\nType: ${extension}`,
              );
            } catch {
              const fileName = contextMenu.path.split("/").pop() || "";
              alert(`File: ${fileName}\nPath: ${contextMenu.path}`);
            }
          },
        },
        { id: "sep-file", label: "", separator: true, onClick: () => {} },
      );
    }

    items.push(
      {
        id: "copy-path",
        label: "Copy Path",
        icon: <Link />,
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(contextMenu.path);
          } catch {}
        },
      },
      {
        id: "copy-relative-path",
        label: "Copy Relative Path",
        icon: <FileText />,
        onClick: async () => {
          try {
            let relativePath = contextMenu.path;
            if (rootFolderPath && contextMenu.path.startsWith(rootFolderPath)) {
              relativePath = contextMenu.path.substring(rootFolderPath.length + 1);
            }
            await navigator.clipboard.writeText(relativePath);
          } catch {}
        },
      },
      {
        id: "copy",
        label: "Copy",
        icon: <Copy />,
        onClick: () =>
          clipboardActions.copy([{ path: contextMenu.path, is_dir: contextMenu.isDir }]),
      },
      {
        id: "cut",
        label: "Cut",
        icon: <Scissors />,
        onClick: () =>
          clipboardActions.cut([{ path: contextMenu.path, is_dir: contextMenu.isDir }]),
      },
    );

    if (clipboard && contextMenu.isDir) {
      items.push({
        id: "paste",
        label: "Paste",
        icon: <Clipboard />,
        onClick: () => {
          clipboardActions.paste(contextMenu.path).then(() => {
            onRefreshDirectory?.(contextMenu.path);
          });
        },
      });
    }

    items.push(
      {
        id: "rename",
        label: "Rename",
        icon: <Edit />,
        onClick: () => onRenamePath?.(contextMenu.path),
      },
      {
        id: "reveal",
        label: "Reveal in Finder",
        icon: <Eye />,
        onClick: () => {
          if (onRevealInFinder) onRevealInFinder(contextMenu.path);
          else if (window.electron) window.electron.shell.showItemInFolder(contextMenu.path);
          else {
            const parentDir = contextMenu.path.substring(0, contextMenu.path.lastIndexOf("/"));
            window.open(`file://${parentDir}`, "_blank");
          }
        },
      },
      { id: "sep-end", label: "", separator: true, onClick: () => {} },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash />,
        className: "text-red-400",
        onClick: () => onDeleteRequested({ path: contextMenu.path, isDir: contextMenu.isDir }),
      },
    );

    return items;
  }, [
    clipboard,
    clipboardActions,
    contextMenu,
    onCreateNewFolderInDirectory,
    onDeleteRequested,
    onDuplicatePath,
    onFileSelect,
    onGenerateImage,
    onOpenAllFilesInDirectory,
    onRefreshDirectory,
    onRenamePath,
    onRevealInFinder,
    onStartInlineEditing,
    onUploadFile,
    rootFolderPath,
  ]);

  const contextMenuElement = contextMenu ? (
    <ContextMenu
      isOpen
      position={{ x: contextMenu.x, y: contextMenu.y }}
      items={contextMenuItems}
      onClose={() => setContextMenu(null)}
      className="min-w-[220px]"
    />
  ) : null;

  return {
    contextMenu,
    setContextMenu,
    handleContextMenu,
    contextMenuElement,
  };
}
