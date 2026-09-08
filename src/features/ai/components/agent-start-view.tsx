import { useCallback, type ReactNode } from "react";
import { ContinuousAgentsCallout } from "@/features/ai/continuous-agents/continuous-agents-callout";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { openFile } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { Button } from "@/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { Empty, EmptyHeader, EmptyTitle } from "@/ui/empty";
import {
  FileTextIcon,
  FolderOpenIcon,
  PlusIcon,
  SparkleIcon,
  TerminalWindowIcon,
} from "@/ui/icons";

interface AgentStartViewProps {
  children: ReactNode;
  showQuickActions?: boolean;
}

interface ActionItem {
  id: string;
  label: string;
  icon: ReactNode;
  action: () => void;
}

export function AgentStartView({ children, showQuickActions = false }: AgentStartViewProps) {
  const { openTerminalBuffer, openBuffer } = useBufferStore.use.actions();
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder();
  const handleOpenAgent = useNewAgentAction();

  const handleOpenTerminal = useCallback(() => {
    openTerminalBuffer();
  }, [openTerminalBuffer]);

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
      icon: <PlusIcon />,
      action: handleNewFile,
    },
    {
      id: "find",
      label: "Open file",
      icon: <FileTextIcon />,
      action: handleOpenFile,
    },
    {
      id: "terminal",
      label: "New terminal",
      icon: <TerminalWindowIcon />,
      action: handleOpenTerminal,
    },
    {
      id: "research",
      label: "Open folder",
      icon: <FolderOpenIcon />,
      action: handleOpenFolder,
    },
  ];

  const startView = (
    <Empty className="m-auto max-w-2xl gap-4 px-6 py-8" data-slot="agent-start-view">
      <EmptyHeader>
        <EmptyTitle>Where should we begin?</EmptyTitle>
      </EmptyHeader>

      {children}

      <ContinuousAgentsCallout />

      {showQuickActions ? (
        <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
          {quickActions.map((item) => (
            <Button
              key={item.id}
              type="button"
              onClick={item.action}
              variant="default"
              width="full"
              align="start"
              truncate
            >
              {item.icon}
              <span className="min-w-0 truncate">{item.label}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </Empty>
  );

  if (showQuickActions) {
    return <div className="flex size-full min-h-0 flex-1 overflow-auto">{startView}</div>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex size-full min-h-0 flex-1 overflow-auto">
        {startView}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleNewFile}>
          <PlusIcon />
          New File
        </ContextMenuItem>
        <ContextMenuItem onClick={handleOpenFolder}>
          <FolderOpenIcon />
          Open Folder
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void handleOpenFile()}>
          <FileTextIcon />
          Open File
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleOpenTerminal}>
          <TerminalWindowIcon />
          New TerminalWindowIcon
        </ContextMenuItem>
        <ContextMenuItem onClick={handleOpenAgent}>
          <SparkleIcon />
          New Agent
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
