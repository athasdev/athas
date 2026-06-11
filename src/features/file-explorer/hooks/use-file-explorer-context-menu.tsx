import {
  CaretDoubleUpIcon as CaretDoubleUp,
  ClipboardIcon as Clipboard,
  ClockCounterClockwiseIcon as ClockCounterClockwise,
  CopyIcon as Copy,
  PencilSimpleIcon as Edit,
  EyeIcon as Eye,
  FilePlusIcon as FilePlus,
  FileTextIcon as FileText,
  FolderOpenIcon as FolderOpen,
  FolderPlusIcon as FolderPlus,
  ImageIcon,
  InfoIcon as Info,
  LinkIcon as Link,
  ArrowClockwiseIcon as RefreshCw,
  ScissorsIcon as Scissors,
  MagnifyingGlassIcon as Search,
  TerminalWindowIcon as Terminal,
  TrashIcon as Trash,
  XIcon as X,
  UploadIcon as Upload,
  WarningIcon as Warning,
} from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { readFile as readTextFile, writeFile } from "@/features/file-system/controllers/platform";
import {
  buildEnvTemplateContent,
  ENV_TEMPLATE_TARGETS,
  isEnvFileName,
} from "@/features/file-explorer/lib/env-template";
import { openLocalHistoryForPath } from "@/features/local-history/utils/open-local-history";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard.store";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import type { ContextMenuState } from "@/features/file-system/types/app.types";
import { Button } from "@/ui/button";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import Dialog from "@/ui/dialog";
import { toast } from "@/ui/toast";
import { getBaseName, getDirName, getRelativePath, joinPath } from "@/utils/path-helpers";

interface UseFileExplorerContextMenuOptions {
  rootFolderPath?: string;
  onFileSelect: (path: string, isDir: boolean) => void | Promise<void>;
  onCreateNewFileInDirectory?: (
    directoryPath: string,
    fileName: string,
  ) => void | string | Promise<string | undefined>;
  onCreateNewFolderInDirectory?: (directoryPath: string, folderName: string) => void;
  onGenerateImage?: (directoryPath: string) => void;
  onRefreshDirectory?: (path: string) => void;
  onRenamePath?: (path: string, newName?: string) => void;
  onRevealInFinder?: (path: string) => void;
  onUploadFile?: (directoryPath: string) => void;
  onDuplicatePath?: (path: string) => void;
  onAddFolderToWorkspace?: () => void;
  onRemoveFolderFromWorkspace?: (path: string) => void;
  isWorkspaceRootPath?: (path: string) => boolean;
  canRemoveWorkspaceRootPath?: (path: string) => boolean;
  onDeleteRequested: (candidate: { path: string; isDir: boolean }) => void;
  onStartInlineEditing: (path: string, isFolder: boolean) => void;
  onOpenAllFilesInDirectory: (directoryPath: string) => Promise<void>;
}

interface EnvOverwriteDialogState {
  sourcePath: string;
  targetFileName: string;
}

interface PropertiesDialogState {
  fileName: string;
  path: string;
  size: string;
  type: string;
}

const menuIconSpacer = <span aria-hidden="true" />;

function formatFileSize(sizeHeader: string | null): string {
  const bytes = Number(sizeHeader);
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${bytes} bytes`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function useFileExplorerContextMenu({
  rootFolderPath,
  onFileSelect,
  onCreateNewFileInDirectory,
  onCreateNewFolderInDirectory,
  onGenerateImage,
  onRefreshDirectory,
  onRenamePath,
  onRevealInFinder,
  onUploadFile,
  onDuplicatePath,
  onAddFolderToWorkspace,
  onRemoveFolderFromWorkspace,
  isWorkspaceRootPath,
  canRemoveWorkspaceRootPath,
  onDeleteRequested,
  onStartInlineEditing,
  onOpenAllFilesInDirectory,
}: UseFileExplorerContextMenuOptions) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [envOverwriteDialog, setEnvOverwriteDialog] = useState<EnvOverwriteDialogState | null>(
    null,
  );
  const [propertiesDialog, setPropertiesDialog] = useState<PropertiesDialogState | null>(null);
  const clipboardActions = useFileClipboardStore.getState().actions;
  const clipboard = useFileClipboardStore((state) => state.clipboard);

  const createEnvTemplateFile = useCallback(
    async (sourcePath: string, targetFileName: string, options?: { overwrite?: boolean }) => {
      if (!onCreateNewFileInDirectory) return;

      const directoryPath = getDirName(sourcePath);
      const targetPath = joinPath(directoryPath, targetFileName);

      try {
        if (targetPath === sourcePath) {
          toast.error("Choose a different env file name");
          return;
        }

        let targetExists = false;
        try {
          await readTextFile(targetPath);
          targetExists = true;
          if (!options?.overwrite) {
            setEnvOverwriteDialog({ sourcePath, targetFileName });
            return;
          }
        } catch {}

        const sourceContent = await readTextFile(sourcePath);
        const templateContent = buildEnvTemplateContent(sourceContent);
        const createdPath = targetExists
          ? targetPath
          : (await Promise.resolve(onCreateNewFileInDirectory(directoryPath, targetFileName))) ||
            targetPath;

        await writeFile(createdPath, templateContent);

        const bufferStore = useBufferStore.getState();
        const createdBuffer = bufferStore.buffers.find((buffer) => buffer.path === createdPath);
        if (createdBuffer) {
          bufferStore.actions.updateBufferContent(createdBuffer.id, templateContent, false);
        }

        onRefreshDirectory?.(directoryPath);
        toast.success(`Created ${targetFileName}`);
      } catch (error) {
        console.error("Failed to create env template file:", error);
        toast.error(
          `Failed to create ${targetFileName}`,
          error instanceof Error ? error.message : undefined,
        );
      }
    },
    [onCreateNewFileInDirectory, onRefreshDirectory],
  );

  const handleEnvOverwriteConfirm = useCallback(() => {
    if (!envOverwriteDialog) return;
    const { sourcePath, targetFileName } = envOverwriteDialog;
    setEnvOverwriteDialog(null);
    void createEnvTemplateFile(sourcePath, targetFileName, { overwrite: true });
  }, [createEnvTemplateFile, envOverwriteDialog]);

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
          id: "add-folder-to-workspace",
          label: "Add Folder to Workspace",
          icon: <FolderPlus />,
          onClick: () => onAddFolderToWorkspace?.(),
        },
        ...(canRemoveWorkspaceRootPath?.(contextMenu.path)
          ? [
              {
                id: "remove-folder-from-workspace",
                label: "Remove Folder from Workspace",
                icon: <X />,
                onClick: () => onRemoveFolderFromWorkspace?.(contextMenu.path),
              },
            ]
          : []),
        {
          id: "open-all-files",
          label: "Open All Files",
          icon: <FolderOpen />,
          onClick: () => void onOpenAllFilesInDirectory(contextMenu.path),
        },
        {
          id: "collapse-all",
          label: "Collapse All",
          icon: <CaretDoubleUp />,
          onClick: () => useFileTreeStore.getState().collapsePath(contextMenu.path),
        },
        {
          id: "open-terminal",
          label: "Open in Terminal",
          icon: <Terminal />,
          onClick: () => {
            const folderName = getBaseName(contextMenu.path, "terminal");
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
      const fileName = getBaseName(contextMenu.path, "");
      const canCreateEnvTemplate =
        isEnvFileName(fileName) &&
        !contextMenu.path.startsWith("remote://") &&
        Boolean(onCreateNewFileInDirectory);

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
          id: "local-history",
          label: "Local History",
          icon: <ClockCounterClockwise />,
          onClick: () => openLocalHistoryForPath(contextMenu.path),
        },
        ...(canCreateEnvTemplate
          ? [
              { id: "sep-env-template", label: "", separator: true, onClick: () => {} },
              ...ENV_TEMPLATE_TARGETS.map((target, index) => ({
                id: target.id,
                label: target.label,
                icon: index === 0 ? <FilePlus /> : menuIconSpacer,
                onClick: () => void createEnvTemplateFile(contextMenu.path, target.fileName),
              })),
            ]
          : []),
        {
          id: "properties",
          label: "Properties",
          icon: <Info />,
          onClick: async () => {
            const fileName = getBaseName(contextMenu.path, "");
            const extension = fileName.includes(".") ? fileName.split(".").pop() : undefined;
            let size = "Unknown";

            try {
              const stats = await fetch(`file://${contextMenu.path}`, { method: "HEAD" });
              size = formatFileSize(stats.headers.get("content-length"));
            } catch {}

            setPropertiesDialog({
              fileName,
              path: contextMenu.path,
              size,
              type: extension || "No extension",
            });
          },
        },
        { id: "sep-file", label: "", separator: true, onClick: () => {} },
      );
    }

    const shouldShowFileManagementItems =
      !contextMenu.isDir || !isWorkspaceRootPath?.(contextMenu.path);

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
            const relativePath = getRelativePath(contextMenu.path, rootFolderPath);
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

    if (shouldShowFileManagementItems) {
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
              const parentDir = getDirName(contextMenu.path);
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
    } else {
      items.push({
        id: "reveal",
        label: "Reveal in Finder",
        icon: <Eye />,
        onClick: () => onRevealInFinder?.(contextMenu.path),
      });
    }

    return items;
  }, [
    canRemoveWorkspaceRootPath,
    clipboard,
    clipboardActions,
    contextMenu,
    createEnvTemplateFile,
    onCreateNewFolderInDirectory,
    onCreateNewFileInDirectory,
    onDeleteRequested,
    onDuplicatePath,
    onFileSelect,
    onGenerateImage,
    onOpenAllFilesInDirectory,
    onAddFolderToWorkspace,
    onRemoveFolderFromWorkspace,
    onRefreshDirectory,
    onRenamePath,
    onRevealInFinder,
    onStartInlineEditing,
    onUploadFile,
    isWorkspaceRootPath,
    rootFolderPath,
  ]);

  const hasDialog = Boolean(envOverwriteDialog || propertiesDialog);
  const contextMenuElement =
    contextMenu || hasDialog ? (
      <>
        {contextMenu && (
          <ContextMenu
            isOpen
            position={{ x: contextMenu.x, y: contextMenu.y }}
            items={contextMenuItems}
            onClose={() => setContextMenu(null)}
            className="file-tree-context-menu min-w-[220px]"
          />
        )}

        {envOverwriteDialog && (
          <Dialog
            title="Overwrite Env File"
            icon={Warning}
            onClose={() => setEnvOverwriteDialog(null)}
            size="sm"
            footer={
              <>
                <Button variant="ghost" onClick={() => setEnvOverwriteDialog(null)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={handleEnvOverwriteConfirm} compact>
                  Overwrite
                </Button>
              </>
            }
          >
            <p className="ui-font ui-text-sm text-text">
              {envOverwriteDialog.targetFileName} already exists. Overwrite it?
            </p>
          </Dialog>
        )}

        {propertiesDialog && (
          <Dialog
            title="Properties"
            icon={Info}
            onClose={() => setPropertiesDialog(null)}
            size="md"
          >
            <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 ui-font ui-text-sm">
              <dt className="text-text-lighter">File</dt>
              <dd className="min-w-0 break-words text-text">{propertiesDialog.fileName}</dd>
              <dt className="text-text-lighter">Path</dt>
              <dd className="min-w-0 break-words text-text">{propertiesDialog.path}</dd>
              <dt className="text-text-lighter">Size</dt>
              <dd className="text-text">{propertiesDialog.size}</dd>
              <dt className="text-text-lighter">Type</dt>
              <dd className="text-text">{propertiesDialog.type}</dd>
            </dl>
          </Dialog>
        )}
      </>
    ) : null;

  return {
    contextMenu,
    setContextMenu,
    handleContextMenu,
    contextMenuElement,
  };
}
