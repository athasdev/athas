import { open } from "@tauri-apps/plugin-dialog";
import {
  FileText,
  FolderOpen,
  Globe,
  Pencil,
  Plus,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useCustomActionsStore } from "@/features/terminal/stores/custom-actions-store";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuItem } from "@/ui/context-menu";
import { ContextMenu } from "@/ui/context-menu";

interface ActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
}

export function EmptyEditorState() {
  const { openTerminalBuffer, openAgentBuffer, openWebViewerBuffer, openBuffer } =
    useBufferStore.use.actions();
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder();

  const customActions = useCustomActionsStore.use.actions();
  const { addAction, updateAction, deleteAction } = useCustomActionsStore.getState().storeActions;

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
      addAction({ name: command, command });
    }
    handleCancel();
  }, [inputValue, editingActionId, addAction, updateAction, handleCancel]);

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
        id: "open-folder",
        label: "Open Folder",
        icon: <FolderOpen size={12} />,
        onClick: handleOpenFolder,
      },
      {
        id: "open-file",
        label: "Open File",
        icon: <FileText size={12} />,
        onClick: handleOpenFile,
      },
      { id: "sep-1", label: "", separator: true, onClick: () => {} },
      {
        id: "new-terminal",
        label: "New Terminal",
        icon: <Terminal size={12} />,
        onClick: handleOpenTerminal,
      },
      {
        id: "new-agent",
        label: "New Agent",
        icon: <Sparkles size={12} />,
        onClick: handleOpenAgent,
      },
      {
        id: "open-url",
        label: "Open URL",
        icon: <Globe size={12} />,
        onClick: handleOpenWebViewer,
      },
    ];
  }, [handleOpenFolder, handleOpenFile, handleOpenTerminal, handleOpenAgent, handleOpenWebViewer]);

  const actions: ActionItem[] = [
    {
      id: "folder",
      label: "Open Folder",
      icon: <FolderOpen size={14} className="text-text-light" />,
      action: handleOpenFolder,
    },
    {
      id: "file",
      label: "Open File",
      icon: <FileText size={14} className="text-text-light" />,
      action: handleOpenFile,
    },
    {
      id: "terminal",
      label: "New Terminal",
      icon: <Terminal size={14} className="text-text-light" />,
      action: handleOpenTerminal,
    },
    {
      id: "agent",
      label: "New Agent",
      icon: <Sparkles size={14} className="text-text-light" />,
      action: handleOpenAgent,
    },
    {
      id: "web",
      label: "Open URL",
      icon: <Globe size={14} className="text-text-light" />,
      action: handleOpenWebViewer,
    },
  ];

  return (
    <div
      className="flex h-full flex-col items-center justify-center"
      onContextMenu={contextMenu.open}
    >
      <div className="flex w-48 flex-col gap-0.5">
        {actions.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.action}
            className="flex items-center gap-3 rounded px-3 py-1.5 text-left transition-colors hover:bg-hover"
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="text-text text-xs">{item.label}</span>
          </button>
        ))}

        {customActions.length > 0 && (
          <>
            <div className="my-1 h-px bg-border" />
            {customActions.map((action) =>
              editingActionId === action.id ? (
                <div key={action.id} className="px-1">
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="command"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSave}
                    className="w-full rounded border border-border bg-secondary-bg px-2 py-1 text-text text-xs outline-none focus:border-accent"
                  />
                </div>
              ) : (
                <div
                  key={action.id}
                  className="group flex items-center gap-3 rounded px-3 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  <button
                    type="button"
                    onClick={() =>
                      openTerminalBuffer({ name: action.command, command: action.command })
                    }
                    className="flex flex-1 items-center gap-3"
                  >
                    <Terminal size={14} className="shrink-0 text-text-light" />
                    <span className="text-text text-xs">{action.command}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartEdit(action.id, action.command)}
                    className="shrink-0 p-0.5 text-text-lighter opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(action.id, e)}
                    className="shrink-0 p-0.5 text-text-lighter opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ),
            )}
          </>
        )}

        <div className="my-1 h-px bg-border" />

        {isAddingAction ? (
          <div className="px-1">
            <input
              ref={inputRef}
              type="text"
              placeholder="command"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              className="w-full rounded border border-border bg-secondary-bg px-2 py-1 text-text text-xs outline-none focus:border-accent"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={handleStartAdd}
            className="flex items-center gap-3 rounded px-3 py-1.5 text-left transition-colors hover:bg-hover"
          >
            <Plus size={14} className="shrink-0 text-text-lighter" />
            <span className="text-text-light text-xs">Add custom action...</span>
          </button>
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
