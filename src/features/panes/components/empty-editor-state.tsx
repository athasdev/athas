import { open } from "@tauri-apps/plugin-dialog";
import {
  Database,
  FileText,
  FolderOpen,
  Globe,
  Pencil,
  Plus,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useCustomActionsStore } from "@/features/terminal/stores/custom-actions-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import Input from "@/ui/input";

interface ActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
}

const newTabRowClassName =
  "h-auto w-full justify-start gap-3 rounded-md px-3 py-1.5 text-left hover:bg-hover";

export function EmptyEditorState() {
  const { openTerminalBuffer, openAgentBuffer, openWebViewerBuffer, openBuffer } =
    useBufferStore.use.actions();
  const { setIsDatabaseConnectionVisible } = useUIState();
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder();
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);

  const allCustomActions = useCustomActionsStore.use.actions();
  const { addAction, updateAction, deleteAction, getActionsForWorkspace } =
    useCustomActionsStore.getState().storeActions;
  const customActions = useMemo(
    () => getActionsForWorkspace(rootFolderPath),
    [allCustomActions, getActionsForWorkspace, rootFolderPath],
  );

  const contextMenu = useContextMenu();

  const [isAddingAction, setIsAddingAction] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpenTerminal = useCallback(() => {
    openTerminalBuffer();
  }, [openTerminalBuffer]);

  const handleOpenAgent = useCallback(() => {
    openAgentBuffer();
  }, [openAgentBuffer]);

  const handleOpenWebViewer = useCallback(() => {
    openWebViewerBuffer("https://");
  }, [openWebViewerBuffer]);

  const handleOpenDatabaseConnection = useCallback(() => {
    setIsDatabaseConnectionVisible(true);
  }, [setIsDatabaseConnectionVisible]);

  const handleNewFile = useCallback(() => {
    const id = `untitled-${Date.now()}`;
    openBuffer(id, "Untitled", "", false, undefined, false, true);
  }, [openBuffer]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
      });
      if (selected && typeof selected === "string") {
        const fileName = selected.split("/").pop() || selected;
        const content = await readFileContent(selected);
        openBuffer(selected, fileName, content);
      }
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  }, [openBuffer]);

  const handleStartAdd = useCallback(() => {
    setIsAddingAction(true);
    setInputValue("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleStartEdit = useCallback((actionId: string, command: string) => {
    setEditingActionId(actionId);
    setInputValue(command);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleCancel = useCallback(() => {
    setIsAddingAction(false);
    setEditingActionId(null);
    setInputValue("");
  }, []);

  const handleSave = useCallback(() => {
    const command = inputValue.trim();
    if (!command) {
      handleCancel();
      return;
    }

    if (editingActionId) {
      updateAction(editingActionId, { name: command, command });
    } else {
      addAction({ name: command, command, workspacePath: rootFolderPath });
    }
    handleCancel();
  }, [inputValue, editingActionId, addAction, updateAction, handleCancel, rootFolderPath]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        handleCancel();
      }
    },
    [handleSave, handleCancel],
  );

  const handleDelete = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      deleteAction(id);
    },
    [deleteAction],
  );

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    return [
      {
        id: "new-file",
        label: "New File",
        icon: <Plus />,
        onClick: handleNewFile,
      },
      {
        id: "open-folder",
        label: "Open Folder",
        icon: <FolderOpen />,
        onClick: handleOpenFolder,
      },
      {
        id: "open-file",
        label: "Open File",
        icon: <FileText />,
        onClick: handleOpenFile,
      },
      { id: "sep-1", label: "", separator: true, onClick: () => {} },
      {
        id: "new-terminal",
        label: "New Terminal",
        icon: <Terminal />,
        onClick: handleOpenTerminal,
      },
      {
        id: "new-agent",
        label: "New Agent",
        icon: <Sparkles />,
        onClick: handleOpenAgent,
      },
      {
        id: "open-url",
        label: "Open URL",
        icon: <Globe />,
        onClick: handleOpenWebViewer,
      },
      {
        id: "connect-database",
        label: "Connect Database",
        icon: <Database />,
        onClick: handleOpenDatabaseConnection,
      },
    ];
  }, [
    handleNewFile,
    handleOpenFolder,
    handleOpenFile,
    handleOpenTerminal,
    handleOpenAgent,
    handleOpenWebViewer,
    handleOpenDatabaseConnection,
  ]);

  const actions: ActionItem[] = [
    {
      id: "new-file",
      label: "New File",
      icon: <Plus className="text-text-light" />,
      action: handleNewFile,
    },
    {
      id: "folder",
      label: "Open Folder",
      icon: <FolderOpen className="text-text-light" />,
      action: handleOpenFolder,
    },
    {
      id: "file",
      label: "Open File",
      icon: <FileText className="text-text-light" />,
      action: handleOpenFile,
    },
    {
      id: "terminal",
      label: "New Terminal",
      icon: <Terminal className="text-text-light" />,
      action: handleOpenTerminal,
    },
    {
      id: "agent",
      label: "New Agent",
      icon: <Sparkles className="text-text-light" />,
      action: handleOpenAgent,
    },
    {
      id: "web",
      label: "Open URL",
      icon: <Globe className="text-text-light" />,
      action: handleOpenWebViewer,
    },
    {
      id: "database",
      label: "Connect Database",
      icon: <Database className="text-text-light" />,
      action: handleOpenDatabaseConnection,
    },
  ];

  return (
    <div
      className="flex h-full flex-col items-center justify-center"
      onContextMenu={contextMenu.open}
    >
      <div className="flex w-48 flex-col gap-0.5">
        {actions.map((item) => (
          <Button
            key={item.id}
            type="button"
            onClick={item.action}
            variant="ghost"
            size="sm"
            className={newTabRowClassName}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="text-text text-xs">{item.label}</span>
          </Button>
        ))}

        {customActions.length > 0 && (
          <>
            <div className="my-1 h-px bg-border" />
            {customActions.map((action) =>
              editingActionId === action.id ? (
                <div key={action.id} className="px-1">
                  <Input
                    ref={inputRef}
                    type="text"
                    placeholder="command"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSave}
                    className="w-full bg-secondary-bg"
                  />
                </div>
              ) : (
                <div
                  key={action.id}
                  className="group flex items-center gap-1 rounded-md px-3 py-1.5 hover:bg-hover"
                >
                  <Button
                    type="button"
                    onClick={() =>
                      openTerminalBuffer({ name: action.name, command: action.command })
                    }
                    variant="ghost"
                    size="sm"
                    className="h-auto flex-1 justify-start gap-3 px-0 py-0 hover:bg-transparent"
                  >
                    <Terminal className="shrink-0 text-text-light" />
                    <span className="text-text text-xs">{action.name}</span>
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleStartEdit(action.id, action.command)}
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    onClick={(e) => handleDelete(action.id, e)}
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ),
            )}
          </>
        )}

        <div className="my-1 h-px bg-border" />

        {isAddingAction ? (
          <div className="px-1">
            <Input
              ref={inputRef}
              type="text"
              placeholder="command"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              className="w-full bg-secondary-bg"
            />
          </div>
        ) : (
          <Button
            type="button"
            onClick={handleStartAdd}
            variant="ghost"
            size="sm"
            className={newTabRowClassName}
          >
            <Plus className="shrink-0 text-text-lighter" />
            <span className="text-text-light text-xs">Add custom action...</span>
          </Button>
        )}
      </div>

      {createPortal(
        <ContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          items={getContextMenuItems()}
          onClose={contextMenu.close}
        />,
        document.body,
      )}
    </div>
  );
}
