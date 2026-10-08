import { useMemo } from "react";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";
import { selectPaneBufferFlags } from "@/features/panes/stores/pane-selectors";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { isDirtyContent, isVirtualContent } from "@/features/panes/types/pane-content.types";
import { BufferTypeIcon } from "@/features/tabs/components/buffer-type-icon";
import { CommandEmpty, CommandItemBadge } from "@/ui/command";
import { PinIcon } from "@/ui/icons";
import { matchesSearchQuery, scoreSearchQuery } from "@/utils/search-match";
import { getDirectoryPath } from "@/utils/path-helpers";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import type {
  QuickOpenItem,
  QuickOpenSectionInput,
  QuickOpenSectionResult,
} from "../types/quick-open.types";

const TYPE_LABELS: Partial<Record<PaneContent["type"], string>> = {
  terminal: "Terminal",
  browser: "Browser",
  agent: "Agent",
  database: "Database",
  diff: "Diff",
  pullRequest: "Pull request",
  githubIssue: "Issue",
  githubAction: "Workflow run",
  settings: "Settings",
};

function describeBuffer(buffer: PaneContent, rootFolderPath: string | undefined): string {
  if (buffer.type === "browser" && "url" in buffer && buffer.url) return buffer.url;
  if (!isVirtualContent(buffer) && buffer.path) {
    return getDirectoryPath(buffer.path, rootFolderPath);
  }
  return TYPE_LABELS[buffer.type] ?? "";
}

/** The open tabs, to switch between them by name. */
export function useTabsSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const buffers = useBufferStore((state) => (isActive ? state.buffers : null));
  const activeBufferId = useActiveBufferId();
  const pinnedBufferIds = usePaneStore((state) =>
    isActive ? selectPaneBufferFlags(state).pinnedBufferIds : null,
  );
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);

  const items = useMemo(() => {
    if (!buffers) return [];
    const candidates = buffers
      .filter((buffer) => buffer.type !== "newTab")
      .map((buffer) => ({ buffer, description: describeBuffer(buffer, rootFolderPath) }))
      .filter(({ buffer, description }) =>
        matchesSearchQuery(query, [buffer.name, description, buffer.path]),
      );
    if (query.trim()) {
      candidates.sort(
        (a, b) =>
          scoreSearchQuery(query, [
            { value: b.buffer.name, weight: 4 },
            { value: b.description, weight: 1 },
          ]) -
          scoreSearchQuery(query, [
            { value: a.buffer.name, weight: 4 },
            { value: a.description, weight: 1 },
          ]),
      );
    }
    return candidates.map(({ buffer, description }): QuickOpenItem => ({
      key: buffer.id,
      icon: <BufferTypeIcon buffer={buffer} size={14} />,
      title: <SearchMatchHighlight text={buffer.name} query={query} />,
      description: <SearchMatchHighlight text={description} query={query} />,
      accessory: (
        <>
          {isDirtyContent(buffer) ? (
            <span className="size-2 rounded-full bg-primary" aria-label="Unsaved changes" />
          ) : null}
          {pinnedBufferIds?.has(buffer.id) ? <PinIcon className="text-muted-foreground" /> : null}
          {buffer.id === activeBufferId ? <CommandItemBadge>Active</CommandItemBadge> : null}
        </>
      ),
      select: () => {
        close();
        useBufferStore.getState().actions.setActiveBuffer(buffer.id);
      },
    }));
  }, [activeBufferId, buffers, close, pinnedBufferIds, query, rootFolderPath]);

  return {
    items,
    isLoading: false,
    summary: `${items.length} ${items.length === 1 ? "tab" : "tabs"}`,
    empty: <CommandEmpty>{query ? "No matching tabs" : "No open tabs"}</CommandEmpty>,
  };
}
