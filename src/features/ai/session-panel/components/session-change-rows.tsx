import { useCallback } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { DiffStats } from "@/features/ai/components/diff-stats";
import {
  type AgentSessionChange,
  openAgentSessionReview,
} from "@/features/ai/lib/agent-session-context";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { FileTextIcon } from "@/ui/icons";
import { SidebarIconButton, SidebarListActionRow, SidebarListItem } from "@/ui/sidebar";
import Tooltip from "@/ui/tooltip";
import { getBaseName, getDirName, joinPath } from "@/utils/path-helpers";

function isAbsolutePath(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/** Opens a path the agent reported, which may be relative to the project. */
function useOpenAgentPath() {
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath || null);
  return useCallback(
    (path: string) => {
      const absolutePath =
        isAbsolutePath(path) || !rootFolderPath ? path : joinPath(rootFolderPath, path);
      void handleFileSelect(absolutePath, false);
    },
    [handleFileSelect, rootFolderPath],
  );
}

/**
 * The files a session changed, with a button to open the file. A row opens its net diff in an
 * editor tab, or hands the change to `onSelect` when the host shows the diff itself.
 */
export function AgentSessionChangeRows({
  changes,
  selectedPath,
  onSelect,
}: {
  changes: AgentSessionChange[];
  selectedPath?: string | null;
  onSelect?: (change: AgentSessionChange) => void;
}) {
  const openPath = useOpenAgentPath();

  return changes.map((change) => {
    const fileName = getBaseName(change.displayPath, change.displayPath);
    const directory = getDirName(change.displayPath);
    return (
      <SidebarListActionRow
        key={change.path}
        actions={[
          <SidebarIconButton
            key="open"
            tooltip="Open file"
            aria-label={`Open ${change.displayPath}`}
            onClick={(event) => {
              event.stopPropagation();
              openPath(change.path);
            }}
          >
            <FileTextIcon />
          </SidebarIconButton>,
        ]}
      >
        <Tooltip content={change.displayPath} width="full">
          <SidebarListItem
            density="compact"
            tone={change.phase === "failed" ? "error" : "default"}
            leading={<ThemedFileIcon fileName={fileName} isDir={false} />}
            description={directory || undefined}
            trailing={<DiffStats additions={change.additions} deletions={change.deletions} />}
            active={change.path === selectedPath}
            aria-current={change.path === selectedPath ? "true" : undefined}
            onClick={() => (onSelect ? onSelect(change) : openAgentSessionReview([change]))}
            data-path={change.path}
          >
            {fileName}
          </SidebarListItem>
        </Tooltip>
      </SidebarListActionRow>
    );
  });
}
