import {
  FileTextIcon as FileText,
  FolderOpenIcon as FolderOpen,
  GlobeHemisphereWestIcon as Globe,
  PlusIcon as Plus,
  SparkleIcon as Sparkles,
  TerminalWindowIcon as Terminal,
} from "@/ui/icons";
import { useCallback } from "react";
import { AgentLaunchInput } from "@/features/ai/components/agent-launcher";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { openFile } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ui/empty";

interface ActionItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
  disabled?: boolean;
}

const quickActionCardClassName =
  "h-20 min-w-0 w-full overflow-hidden flex-col items-start justify-between rounded-xl border border-border/65 bg-transparent p-3 text-left text-subtle-foreground hover:border-border-strong/75 hover:bg-accent/35 hover:text-foreground focus-visible:border-border-strong/80 disabled:opacity-45";

const quickActionIconClassName =
  "flex size-7 items-center justify-center rounded-md text-subtle-foreground group-hover:text-foreground";

export function EmptyEditorState() {
  const { openTerminalBuffer, openWebViewerBuffer, openBuffer } = useBufferStore.use.actions();
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder();
  const webViewerEnabled = useSettingsStore((state) => state.settings.coreFeatures.webViewer);

  const handleOpenTerminal = useCallback(() => {
    openTerminalBuffer();
  }, [openTerminalBuffer]);

  const handleOpenAgent = useNewAgentAction();

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
    <ContextMenu>
      <ContextMenuTrigger className="flex h-full min-h-0 w-full overflow-auto">
        <Empty className="m-auto max-w-2xl gap-4 px-6 py-8">
          <EmptyHeader>
            <EmptyMedia className="size-8 text-foreground">
              <Sparkles className="size-5" weight="duotone" />
            </EmptyMedia>
            <EmptyTitle className="ui-text-lg">Where should we begin?</EmptyTitle>
          </EmptyHeader>

          <AgentLaunchInput active autoFocus />

          <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
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
                <span className="flex w-full min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium text-foreground ui-text-sm">
                    {item.label}
                  </span>
                  <span className="truncate text-subtle-foreground ui-text-sm">
                    {item.description}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </Empty>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleNewFile}>
          <Plus />
          New File
        </ContextMenuItem>
        <ContextMenuItem onClick={handleOpenFolder}>
          <FolderOpen />
          Open Folder
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void handleOpenFile()}>
          <FileText />
          Open File
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleOpenTerminal}>
          <Terminal />
          New Terminal
        </ContextMenuItem>
        <ContextMenuItem onClick={handleOpenAgent}>
          <Sparkles />
          New Agent
        </ContextMenuItem>
        {webViewerEnabled && (
          <ContextMenuItem onClick={handleOpenWebViewer}>
            <Globe />
            Open URL
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
