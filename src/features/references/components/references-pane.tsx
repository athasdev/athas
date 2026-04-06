import {
  ChevronDown,
  ChevronRight,
  FileCode,
  Loader2,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { editorAPI } from "@/features/editor/extensions/api";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { Button } from "@/ui/button";
import { PANE_CHIP_BASE, paneHeaderClassName, paneIconButtonClassName } from "@/ui/pane";
import { useReferencesStore } from "../stores/references-store";
import type { Reference } from "../types/reference";

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

  const handleReferenceClick = useCallback(async (ref: Reference) => {
    const bufferStore = useBufferStore.getState();
    const existingBuffer = bufferStore.buffers.find((b) => b.path === ref.filePath);

    if (existingBuffer) {
      bufferStore.actions.setActiveBuffer(existingBuffer.id);
    } else {
      const content = await readFileContent(ref.filePath);
      const fileName = getFileName(ref.filePath);
      const bufferId = bufferStore.actions.openBuffer(ref.filePath, fileName, content);
      bufferStore.actions.setActiveBuffer(bufferId);
    }

    setTimeout(() => {
      const lines = editorAPI.getLines();
      let offset = 0;
      for (let i = 0; i < ref.line; i++) {
        offset += (lines[i]?.length || 0) + 1;
      }
      offset += ref.column;

      editorAPI.setCursorPosition({
        line: ref.line,
        column: ref.column,
        offset,
      });
    }, 100);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className={paneHeaderClassName("justify-between border-border/70 border-b")}>
        <div className="flex items-center gap-1.5">
          <span className="ui-font ui-text-sm font-medium text-text">References</span>
          {query && <span className={PANE_CHIP_BASE}>{query.symbol}</span>}
          <span className={PANE_CHIP_BASE}>{isLoading ? "..." : references.length}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {onFullScreen && (
            <Button
              onClick={onFullScreen}
              className={paneIconButtonClassName()}
              aria-label={isFullScreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullScreen ? <Minimize2 /> : <Maximize2 />}
            </Button>
          )}
          <Button
            onClick={() => useReferencesStore.getState().actions.clear()}
            className={paneIconButtonClassName()}
            aria-label="Clear references"
          >
            <X />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-text-lighter">
            <Loader2 size={14} className="animate-spin" />
            <span className="ui-font ui-text-sm">Finding references...</span>
          </div>
        ) : references.length === 0 ? (
          <div className="px-3 py-4 text-text-lighter">
            <span className="ui-font ui-text-sm">
              {query ? "No references found" : "Use Shift+F12 to find references"}
            </span>
          </div>
        ) : (
          grouped.map((group) => {
            const isCollapsed = collapsedGroups[group.filePath];
            return (
              <div key={group.filePath}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.filePath)}
                  className="flex w-full items-center gap-1 px-2 py-1 text-left transition-colors hover:bg-hover/50"
                >
                  {isCollapsed ? (
                    <ChevronRight size={12} className="shrink-0 text-text-lighter" />
                  ) : (
                    <ChevronDown size={12} className="shrink-0 text-text-lighter" />
                  )}
                  <FileCode size={12} className="shrink-0 text-accent" />
                  <span className="ui-font ui-text-sm truncate font-medium text-text">
                    {group.fileName}
                  </span>
                  <span className="ui-font ui-text-xs shrink-0 text-text-lighter">
                    {group.items.length}
                  </span>
                </button>
                {!isCollapsed &&
                  group.items.map((ref, index) => (
                    <button
                      type="button"
                      key={`${ref.filePath}:${ref.line}:${ref.column}:${index}`}
                      onClick={() => void handleReferenceClick(ref)}
                      className="group flex w-full items-baseline gap-2 py-0.5 pr-2 pl-7 text-left transition-colors hover:bg-hover/50"
                    >
                      <span className="ui-font ui-text-xs shrink-0 tabular-nums text-text-lighter">
                        {ref.line + 1}
                      </span>
                      <span className="ui-font ui-text-sm truncate text-text-lighter group-hover:text-text">
                        {ref.lineContent.trim()}
                      </span>
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ReferencesPane;
