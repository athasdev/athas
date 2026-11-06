import {
  ArrowClockwiseIcon,
  ChevronDoubleUpIcon,
  ClipboardIcon,
  CopyIcon,
  EyeIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HistoryIcon,
  ImageIcon,
  InfoIcon,
  LinkIcon,
  PenIcon,
  ScissorsIcon,
  SearchIcon,
  SquareArrowUpIcon,
  TerminalWindowIcon,
  TrashIcon,
  UploadIcon,
  WarningIcon,
  XIcon,
} from "@/ui/icons";
import { stat } from "@tauri-apps/plugin-fs";
import { showSystemSharePicker, toggleQuickLookPreview } from "@/utils/local-files";
import { useCallback, useMemo, useState } from "react";
import { writeClipboardText } from "@/utils/clipboard";
import { readBufferText } from "@/features/editor/services/buffer-text";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { writeFile } from "@/features/file-system/api/file-system-api";
import { getWorkspaceResourceProvider } from "@/features/file-system/services/workspace-resource-provider";
import {
  buildEnvTemplateContent,
  ENV_TEMPLATE_TARGETS,
  isEnvFileName,
} from "@/features/file-explorer/lib/env-template";
import { openLocalHistoryForPath } from "@/features/local-history/services/open-local-history";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard.store";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import { pasteFileClipboard } from "@/features/file-explorer/services/paste-file-clipboard";
import { getSelectionActionTargets } from "@/features/file-explorer/utils/file-tree-selection";
import { useGlobalSearchSessionStore } from "@/features/global-search/stores/global-search-session.store";
import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import { parseRemotePath } from "@/features/remote/services/remote-path";
import { parseWslPath } from "@/features/wsl/services/wsl-path";
import type { ContextMenuState } from "@/features/file-system/types/app.types";
import { Button } from "@/ui/button";
import { ContextMenuPopup, createContextMenuGroups } from "@/ui/context-menu";
import { menuSeparator, type MenuItem } from "@/ui/dropdown";
import Dialog from "@/ui/dialog";
import { toast } from "sonner";
import { getBaseName, getDirName, getRelativePath, joinPath } from "@/utils/path-helpers";
import { IS_MAC, IS_WINDOWS } from "@/utils/platform";

interface UseFileExplorerContextMenuOptions {
  rootFolderPath?: string;
  onFileSelect: (path: string, isDir: boolean) => void | Promise<void>;
  onCreateNewFileInDirectory?: (
    directoryPath: string,
    fileName: string,
  ) => void | string | Promise<string | undefined>;
  onCreateNewFolderInDirectory?: (directoryPath: string, folderName: string) => void;
  onGenerateImage?: (directoryPath: string) => void;
  onRefreshDirectory?: (path: string, options?: { force?: boolean }) => void;
  onRenamePath?: (path: string, newName?: string) => void;
  onRevealInFinder?: (path: string) => void;
  onUploadFile?: (directoryPath: string) => void;
  onDuplicatePath?: (path: string) => void;
  onAddFolderToWorkspace?: () => void;
  onRemoveFolderFromWorkspace?: (path: string) => void;
  isWorkspaceRootPath?: (path: string) => boolean;
  canRemoveWorkspaceRootPath?: (path: string) => boolean;
  onDeleteRequested: (candidates: Array<{ path: string; isDir: boolean }>) => void;
  /** The rows selected together, when more than one is; actions on one of them apply to all. */
  getSelectedEntries?: () => Array<{ path: string; isDir: boolean }> | null;
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

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WINDOWS
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

function readEntryText(path: string): Promise<string> {
  const openBuffer = useBufferStore
    .getState()
    .buffers.find((buffer) => buffer.path === path && buffer.type === "editor");
  if (openBuffer) return Promise.resolve(readBufferText(openBuffer));
  return getWorkspaceResourceProvider(path).readText(path);
}

/** The path a user would paste into a shell on the machine that holds the file. */
function getCopyablePath(path: string): string {
  return parseRemotePath(path)?.remotePath ?? path;
}

async function readFileSize(path: string): Promise<string> {
  if (parseRemotePath(path) || parseWslPath(path)) return "Unknown";
  try {
    const info = await stat(path);
    return formatFileSize(String(info.size));
  } catch {
    return "Unknown";
  }
}

async function copyTextToClipboard(text: string, what: string) {
  try {
    await writeClipboardText(text);
  } catch (error) {
    toast.error(`Could not copy ${what}`, {
      description: error instanceof Error ? error.message : String(error),
    });
  }
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
  getSelectedEntries,
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
          await readEntryText(targetPath);
          targetExists = true;
          if (!options?.overwrite) {
            setEnvOverwriteDialog({ sourcePath, targetFileName });
            return;
          }
        } catch {}

        const sourceContent = await readEntryText(sourcePath);
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

        onRefreshDirectory?.(directoryPath, { force: true });
        toast.success(`Created ${targetFileName}`);
      } catch (error) {
        console.error("Failed to create env template file:", error);
        toast.error(`Failed to create ${targetFileName}`, {
          description: error instanceof Error ? error.message : undefined,
        });
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

    // The menu keeps itself on screen; clamping here moved it away from the pointer and broke
    // keyboard invocation, which is recognized by the event's own coordinates.
    setContextMenu({ x: e.clientX, y: e.clientY, path: filePath, isDir });
  }, []);

  const contextMenuItems = useMemo<MenuItem[]>(() => {
    if (!contextMenu) return [];
    const targets = getSelectionActionTargets(
      { path: contextMenu.path, isDir: contextMenu.isDir },
      getSelectedEntries?.(),
    );
    const clipboardEntries = targets.map((target) => ({ path: target.path, is_dir: target.isDir }));

    const items: MenuItem[] = [];

    if (contextMenu.isDir) {
      items.push(
        {
          id: "new-file",
          label: "New File",
          icon: <FilePlusIcon />,
          onClick: () => onStartInlineEditing(contextMenu.path, false),
        },
        {
          id: "new-folder",
          label: "New Folder",
          icon: <FolderPlusIcon />,
          onClick: () => {
            if (onCreateNewFolderInDirectory) onStartInlineEditing(contextMenu.path, true);
          },
        },
        ...(onUploadFile
          ? [
              {
                id: "upload-files",
                label: "Upload Files",
                icon: <UploadIcon />,
                onClick: () => onUploadFile(contextMenu.path),
              },
            ]
          : []),
        {
          id: "refresh",
          label: "Refresh",
          icon: <ArrowClockwiseIcon />,
          onClick: () => onRefreshDirectory?.(contextMenu.path, { force: true }),
        },
        {
          id: "add-folder-to-workspace",
          label: "Add Folder to Workspace",
          icon: <FolderPlusIcon />,
          onClick: () => onAddFolderToWorkspace?.(),
        },
        ...(canRemoveWorkspaceRootPath?.(contextMenu.path)
          ? [
              {
                id: "remove-folder-from-workspace",
                label: "Remove Folder from Workspace",
                icon: <XIcon />,
                onClick: () => onRemoveFolderFromWorkspace?.(contextMenu.path),
              },
            ]
          : []),
        {
          id: "open-all-files",
          label: "Open All Files",
          icon: <FolderOpenIcon />,
          onClick: () => void onOpenAllFilesInDirectory(contextMenu.path),
        },
        {
          id: "collapse-all",
          label: "Collapse All",
          icon: <ChevronDoubleUpIcon />,
          onClick: () => useFileTreeStore.getState().actions.collapsePath(contextMenu.path),
        },
        {
          id: "open-terminal",
          label: "Open in Terminal",
          icon: <TerminalWindowIcon />,
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
          icon: <SearchIcon />,
          onClick: () => {
            const relativePath = getRelativePath(contextMenu.path, rootFolderPath);
            const isInsideRoot = Boolean(rootFolderPath) && relativePath !== contextMenu.path;
            useGlobalSearchSessionStore
              .getState()
              .actions.setIncludeQuery(isInsideRoot && relativePath ? `${relativePath}/**` : "");
            void keymapRegistry.executeCommand("workbench.showGlobalSearch");
          },
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

      items.push({ id: "sep-dir", separator: true });
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
          icon: <FolderOpenIcon />,
          onClick: () => onFileSelect(contextMenu.path, false),
        },
        {
          id: "copy-content",
          label: "Copy Content",
          icon: <CopyIcon />,
          onClick: async () => {
            try {
              await writeClipboardText(await readEntryText(contextMenu.path));
            } catch (error) {
              toast.error(`Could not copy the contents of ${fileName}`, {
                description: error instanceof Error ? error.message : String(error),
              });
            }
          },
        },
        {
          id: "duplicate-file",
          label: "Duplicate",
          icon: <FileTextIcon />,
          onClick: () => {
            for (const target of targets) {
              if (!target.isDir) onDuplicatePath?.(target.path);
            }
          },
        },
        {
          id: "local-history",
          label: "Local History",
          icon: <HistoryIcon />,
          onClick: () => openLocalHistoryForPath(contextMenu.path),
        },
        ...(canCreateEnvTemplate
          ? [
              menuSeparator("sep-env-template"),
              ...ENV_TEMPLATE_TARGETS.filter(
                (target) => target.fileName.toLowerCase() !== fileName.toLowerCase(),
              ).map((target, index) => ({
                id: target.id,
                label: target.label,
                icon: index === 0 ? <FilePlusIcon /> : menuIconSpacer,
                onClick: () => void createEnvTemplateFile(contextMenu.path, target.fileName),
              })),
            ]
          : []),
        {
          id: "properties",
          label: "Properties",
          icon: <InfoIcon />,
          onClick: async () => {
            const extension =
              fileName.lastIndexOf(".") > 0 ? fileName.slice(fileName.lastIndexOf(".") + 1) : "";
            const size = await readFileSize(contextMenu.path);

            setPropertiesDialog({
              fileName,
              path: contextMenu.path,
              size,
              type: extension || "No extension",
            });
          },
        },
        { id: "sep-file", separator: true },
      );
    }

    const shouldShowFileManagementItems =
      !contextMenu.isDir || !isWorkspaceRootPath?.(contextMenu.path);

    items.push(
      {
        id: "copy-path",
        label: "Copy Path",
        icon: <LinkIcon />,
        onClick: () => copyTextToClipboard(getCopyablePath(contextMenu.path), "the path"),
      },
      {
        id: "copy-relative-path",
        label: "Copy Relative Path",
        icon: <FileTextIcon />,
        onClick: () =>
          copyTextToClipboard(
            getRelativePath(contextMenu.path, rootFolderPath) || ".",
            "the relative path",
          ),
      },
      {
        id: "copy",
        label: "Copy",
        icon: <CopyIcon />,
        onClick: () => clipboardActions.copy(clipboardEntries),
      },
      {
        id: "cut",
        label: "Cut",
        icon: <ScissorsIcon />,
        onClick: () => clipboardActions.cut(clipboardEntries),
      },
    );

    if (clipboard) {
      // On a file, paste lands next to it, as the tree's paste shortcut does.
      const pasteTarget = contextMenu.isDir ? contextMenu.path : getDirName(contextMenu.path);
      items.push({
        id: "paste",
        label: "Paste",
        icon: <ClipboardIcon />,
        onClick: () => void pasteFileClipboard(pasteTarget),
      });
    }

    if (shouldShowFileManagementItems) {
      if (IS_MAC && !contextMenu.isDir) {
        items.push(
          {
            id: "quick-look",
            label: "Quick Look",
            icon: <EyeIcon />,
            onClick: () => {
              void toggleQuickLookPreview(contextMenu.path).catch((error) => {
                toast.error(`Unable to preview file: ${String(error)}`);
              });
            },
          },
          {
            id: "share",
            label: "Share…",
            icon: <SquareArrowUpIcon />,
            onClick: () => {
              void showSystemSharePicker(contextMenu.path).catch((error) => {
                toast.error(`Unable to share file: ${String(error)}`);
              });
            },
          },
        );
      }

      items.push(
        {
          id: "rename",
          label: "Rename",
          icon: <PenIcon />,
          onClick: () => onRenamePath?.(contextMenu.path),
        },
        {
          id: "reveal",
          label: REVEAL_LABEL,
          icon: <EyeIcon />,
          onClick: () => onRevealInFinder?.(contextMenu.path),
        },
        { id: "sep-end", separator: true },
        {
          id: "delete",
          label: "Delete",
          icon: <TrashIcon />,
          tone: "destructive",
          onClick: () => onDeleteRequested(targets),
        },
      );
    } else {
      items.push({
        id: "reveal",
        label: REVEAL_LABEL,
        icon: <EyeIcon />,
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
    getSelectedEntries,
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
          <ContextMenuPopup
            isOpen
            point={{ x: contextMenu.x, y: contextMenu.y }}
            groups={createContextMenuGroups(contextMenuItems)}
            onClose={() => setContextMenu(null)}
          />
        )}

        {envOverwriteDialog && (
          <Dialog
            title="Overwrite Env File"
            icon={WarningIcon}
            onClose={() => setEnvOverwriteDialog(null)}
            footer={
              <>
                <Button variant="ghost" onClick={() => setEnvOverwriteDialog(null)}>
                  Cancel
                </Button>
                <Button variant="ghost" tone="danger" onClick={handleEnvOverwriteConfirm}>
                  Overwrite
                </Button>
              </>
            }
          >
            <p className="font-sans ui-text-base text-foreground">
              {envOverwriteDialog.targetFileName} already exists. Overwrite it?
            </p>
          </Dialog>
        )}

        {propertiesDialog && (
          <Dialog title="Properties" icon={InfoIcon} onClose={() => setPropertiesDialog(null)}>
            <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 font-sans ui-text-base">
              <dt className="text-subtle-foreground">File</dt>
              <dd className="min-w-0 wrap-break-word text-foreground">
                {propertiesDialog.fileName}
              </dd>
              <dt className="text-subtle-foreground">Path</dt>
              <dd className="min-w-0 wrap-break-word text-foreground">{propertiesDialog.path}</dd>
              <dt className="text-subtle-foreground">Size</dt>
              <dd className="text-foreground">{propertiesDialog.size}</dd>
              <dt className="text-subtle-foreground">Type</dt>
              <dd className="text-foreground">{propertiesDialog.type}</dd>
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
