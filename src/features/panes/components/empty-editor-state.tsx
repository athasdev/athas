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
import { ThinkingOrb } from "@/ui/thinking-orb";

interface ActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
}

const quickActionCardClassName =
  "h-9 min-w-0 w-full justify-start gap-2 overflow-hidden rounded-lg bg-accent/25 px-3 text-subtle-foreground hover:bg-accent/60 hover:text-foreground";

const quickActionIconClassName =
  "flex size-4 shrink-0 items-center justify-center text-subtle-foreground group-hover:text-foreground";

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
      label: "New file",
      icon: <Plus />,
      action: handleNewFile,
    },
    {
      id: "find",
      label: "Open file",
      icon: <FileText />,
      action: handleOpenFile,
    },
    {
      id: "terminal",
      label: "New terminal",
      icon: <Terminal />,
      action: handleOpenTerminal,
    },
    {
      id: "research",
      label: webViewerEnabled ? "Open URL" : "Open folder",
      icon: webViewerEnabled ? <Globe /> : <FolderOpen />,
      action: webViewerEnabled ? handleOpenWebViewer : handleOpenFolder,
    },
  ];

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-full min-h-0 w-full overflow-auto">
        <Empty className="m-auto max-w-2xl gap-4 px-6 py-8">
          <EmptyHeader>
            <EmptyMedia className="size-16">
              <ThinkingOrb state="shaping" size={64} aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle className="ui-text-lg">Where should we begin?</EmptyTitle>
          </EmptyHeader>

          <AgentLaunchInput active autoFocus surfaceId="empty-editor" />

          <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
            {quickActions.map((item) => (
              <Button
                key={item.id}
                type="button"
                onClick={item.action}
                variant="ghost"
                className={`group ${quickActionCardClassName}`}
              >
                <span className={quickActionIconClassName}>{item.icon}</span>
                <span className="min-w-0 truncate ui-text-sm">{item.label}</span>
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
