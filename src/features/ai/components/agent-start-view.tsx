import { useCallback, type ReactNode } from "react";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { readFileContent } from "@/features/file-system/api/file-operations";
import { openFile } from "@/features/file-system/api/file-system-api";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
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

export function AgentStartView({ children }: { children: ReactNode }) {
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

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex size-full min-h-0 flex-1 overflow-auto">
        <Empty className="m-auto max-w-2xl gap-5 px-6 py-8" data-slot="agent-start-view">
          <EmptyHeader className="max-w-md">
            <EmptyTitle className="ui-text-lg">Where should we begin?</EmptyTitle>
          </EmptyHeader>
          {children}
        </Empty>
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
          New Terminal
        </ContextMenuItem>
        <ContextMenuItem onClick={handleOpenAgent}>
          <SparkleIcon />
          New Agent
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
