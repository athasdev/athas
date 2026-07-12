import {
  FileTextIcon as FileText,
  FolderOpenIcon as FolderOpen,
  GlobeHemisphereWestIcon as Globe,
  PlusIcon as Plus,
  SparkleIcon as Sparkles,
  TerminalWindowIcon as Terminal,
} from "@/ui/icons";
import { useCallback } from "react";
import { createPortal } from "react-dom";
import { AgentLaunchInput } from "@/features/ai/components/agent-launcher";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { openFile } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";

interface ActionItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
  disabled?: boolean;
}

const quickActionCardClassName =
  "h-20 w-full flex-col items-start justify-between rounded-[var(--app-radius-card)] border border-border/65 bg-transparent p-3 text-left text-text-lighter hover:border-border-strong/75 hover:bg-hover/35 hover:text-text focus-visible:border-border-strong/80 disabled:opacity-45";

const quickActionIconClassName =
  "flex size-7 items-center justify-center rounded-[var(--app-radius-control-sm)] text-text-lighter group-hover:text-text";

export function EmptyEditorState() {
  const { openTerminalBuffer, openAgentBuffer, openWebViewerBuffer, openBuffer } =
    useBufferStore.use.actions();
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder();
  const webViewerEnabled = useSettingsStore((state) => state.settings.coreFeatures.webViewer);

  const contextMenu = useContextMenu();

  const handleOpenTerminal = useCallback(() => {
    openTerminalBuffer();
  }, [openTerminalBuffer]);

  const handleOpenAgent = useCallback(() => {
    openAgentBuffer();
  }, [openAgentBuffer]);

  const handleOpenWebViewer = useCallback(() => {
    openWebViewerBuffer("https://");
  }, [openWebViewerBuffer]);

  const handleNewFile = useCallback(() => {
    const id = `untitled-${Date.now()}`;
    openBuffer(id, "Untitled", "", false, undefined, false, true);
  }, [openBuffer]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await openFile();
      if (selected && typeof selected === "string") {
        const fileName = selected.split("/").pop() || selected;
        const content = await readFileContent(selected);
        openBuffer(selected, fileName, content);
      }
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  }, [openBuffer]);

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
      ...(webViewerEnabled
        ? [
            {
              id: "open-url",
              label: "Open URL",
              icon: <Globe />,
              onClick: handleOpenWebViewer,
            },
          ]
        : []),
    ];
  }, [
    handleNewFile,
    handleOpenFolder,
    handleOpenFile,
    handleOpenTerminal,
    handleOpenAgent,
    handleOpenWebViewer,
    webViewerEnabled,
  ]);

  const quickActions: ActionItem[] = [
    {
      id: "new-file",
      label: "Create",
      description: "New file",
      icon: <Plus />,
      action: handleNewFile,
    },
    {
      id: "find",
      label: "Find",
      description: "Open file",
      icon: <FileText />,
      action: handleOpenFile,
    },
    {
      id: "terminal",
      label: "Run",
      description: "New terminal",
      icon: <Terminal />,
      action: handleOpenTerminal,
    },
    {
      id: "research",
      label: "Research",
      description: "Apps and web",
      icon: <Globe />,
      action: webViewerEnabled ? handleOpenWebViewer : handleOpenFolder,
      disabled: !webViewerEnabled,
    },
  ];

  return (
    <div className="flex h-full min-h-0 w-full overflow-auto" onContextMenu={contextMenu.open}>
      <div className="m-auto flex w-[min(680px,calc(100%-56px))] min-w-0 flex-col items-center gap-4 px-6 py-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-8 items-center justify-center text-text">
            <Sparkles className="size-5" weight="duotone" />
          </span>
          <h1 className="font-medium text-text ui-text-lg">Where should we begin?</h1>
        </div>

        <div className="w-full rounded-[var(--app-radius-card)] border border-border/70 bg-secondary-bg/16 p-3">
          <AgentLaunchInput active autoFocus variant="hero" />
        </div>

        <div className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
          {quickActions.map((item) => (
            <Button
              key={item.id}
              type="button"
              onClick={item.action}
              variant="ghost"
              disabled={item.disabled}
              className={`group ${quickActionCardClassName}`}
            >
              <span className={quickActionIconClassName}>{item.icon}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-text ui-text-sm">{item.label}</span>
                <span className="text-text-lighter ui-text-sm">{item.description}</span>
              </span>
            </Button>
          ))}
        </div>
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
