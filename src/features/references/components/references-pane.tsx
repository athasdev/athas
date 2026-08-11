import {
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  FileCodeIcon as FileCode,
  ArrowsOutIcon as Maximize2,
  ArrowsInIcon as Minimize2,
  XIcon as X,
} from "@/ui/icons";
import { useCallback, useMemo, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { Empty, EmptyDescription } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import {
  PaneChip,
  PaneIconButton,
  paneHeaderClassName,
} from "@/features/panes/components/pane-chrome";
import { useReferencesStore } from "../stores/references.store";
import type { Reference } from "../types/reference.types";

interface ReferencesPaneProps {
  onFullScreen?: () => void;
  isFullScreen?: boolean;
}

interface ReferenceGroup {
  filePath: string;
  fileName: string;
  items: Reference[];
}

const getFileName = (filePath: string) => {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
};

const ReferencesPane = ({ onFullScreen, isFullScreen = false }: ReferencesPaneProps) => {
  const references = useReferencesStore.use.references();
  const query = useReferencesStore.use.query();
  const isLoading = useReferencesStore.use.isLoading();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const grouped = useMemo<ReferenceGroup[]>(() => {
    const byFile = new Map<string, Reference[]>();
    for (const ref of references) {
      const existing = byFile.get(ref.filePath) || [];
      existing.push(ref);
      byFile.set(ref.filePath, existing);
    }
    return Array.from(byFile.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([filePath, items]) => ({
        filePath,
        fileName: getFileName(filePath),
        items: items.sort((a, b) => a.line - b.line || a.column - b.column),
      }));
  }, [references]);

  const toggleGroup = useCallback((filePath: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [filePath]: !prev[filePath] }));
  }, []);

  const handleReferenceClick = useCallback(
    (ref: Reference) => {
      void handleFileSelect?.(ref.filePath, false, ref.line + 1, ref.column + 1, undefined, false);
    },
    [handleFileSelect],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className={paneHeaderClassName("justify-between border-border/70 border-b")}>
        <div className="flex items-center gap-1.5">
          <span className="font-sans ui-text-sm font-medium text-foreground">References</span>
          {query && <PaneChip>{query.symbol}</PaneChip>}
          <PaneChip>{isLoading ? "..." : references.length}</PaneChip>
        </div>
        <div className="flex items-center gap-0.5">
          {onFullScreen && (
            <PaneIconButton
              onClick={onFullScreen}
              tooltip={isFullScreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullScreen ? <Minimize2 /> : <Maximize2 />}
            </PaneIconButton>
          )}
          <PaneIconButton
            onClick={() => useReferencesStore.getState().actions.clear()}
            tooltip="Clear references"
          >
            <X />
          </PaneIconButton>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <Empty className="min-h-0 flex-none items-start rounded-none px-3 py-4 text-left">
            <EmptyDescription>
              <Spinner label="Finding references" showLabel compact />
            </EmptyDescription>
          </Empty>
        ) : references.length === 0 ? (
          <Empty className="min-h-0 flex-none items-start rounded-none px-3 py-4 text-left">
            <EmptyDescription>
              {query ? "No references found" : "Use Shift+F12 to find references"}
            </EmptyDescription>
          </Empty>
        ) : (
          grouped.map((group) => {
            const isCollapsed = collapsedGroups[group.filePath];
            return (
              <div key={group.filePath}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.filePath)}
                  className="flex w-full items-center gap-1 px-2 py-1 text-left transition-colors hover:bg-accent/50"
                >
                  {isCollapsed ? (
                    <ChevronRight size={12} className="shrink-0 text-subtle-foreground" />
                  ) : (
                    <ChevronDown size={12} className="shrink-0 text-subtle-foreground" />
                  )}
                  <FileCode size={12} className="shrink-0 text-primary" />
                  <span className="font-sans ui-text-sm truncate font-medium text-foreground">
                    {group.fileName}
                  </span>
                  <span className="font-sans ui-text-sm shrink-0 text-subtle-foreground">
                    {group.items.length}
                  </span>
                </button>
                {!isCollapsed &&
                  group.items.map((ref, index) => (
                    <button
                      type="button"
                      key={`${ref.filePath}:${ref.line}:${ref.column}:${index}`}
                      onClick={() => void handleReferenceClick(ref)}
                      className="group flex w-full items-baseline gap-2 py-0.5 pr-2 pl-7 text-left transition-colors hover:bg-accent/50"
                    >
                      <span className="font-sans ui-text-sm shrink-0 tabular-nums text-subtle-foreground">
                        {ref.line + 1}
                      </span>
                      <span className="font-sans ui-text-sm truncate text-subtle-foreground group-hover:text-foreground">
                        {ref.lineContent.trim()}
                      </span>
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </ScrollArea>
    </div>
  );
};

export default ReferencesPane;
