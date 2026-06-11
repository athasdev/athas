import { useCallback, useMemo } from "react";
import { usePaneStore } from "../stores/pane.store";
import type { PaneNode } from "../types/pane.types";
import { flattenPaneSplit, type FlatPaneEntry } from "../utils/pane-tree";
import { PaneContainer } from "./pane-container";
import { PaneResizeHandle } from "./pane-resize-handle";

interface PaneNodeRendererProps {
  hiddenPaneId?: string | null;
  node: PaneNode;
}

interface FlatResizeHandleProps {
  direction: "horizontal" | "vertical";
  handleCount: number;
  index: number;
  entries: FlatPaneEntry[];
  onReset: (index: number) => void;
  onResize: (index: number, sizes: [number, number]) => void;
}

function FlatResizeHandle({
  direction,
  handleCount,
  index,
  entries,
  onReset,
  onResize,
}: FlatResizeHandleProps) {
  const handleResize = useCallback(
    (sizes: [number, number]) => {
      onResize(index, sizes);
    },
    [index, onResize],
  );

  const handleReset = useCallback(() => {
    onReset(index);
  }, [index, onReset]);

  const initialSizes: [number, number] = [entries[index].size, entries[index + 1].size];

  return (
    <PaneResizeHandle
      direction={direction}
      onResize={handleResize}
      onReset={handleReset}
      initialSizes={initialSizes}
      resizeHandleCount={handleCount}
    />
  );
}

export function PaneNodeRenderer({ node, hiddenPaneId = null }: PaneNodeRendererProps) {
  const { distributePaneSplit, resizePaneSplit } = usePaneStore.use.actions();
  const isHorizontal = node.type === "split" ? node.direction === "horizontal" : false;

  const flatEntries = useMemo(() => {
    if (node.type !== "split") return null;
    return flattenPaneSplit(node);
  }, [node]);

  const handleFlatResize = useCallback(
    (index: number, sizes: [number, number]) => {
      if (node.type !== "split") return;
      resizePaneSplit(node.id, index, sizes);
    },
    [node, resizePaneSplit],
  );

  const handleFlatReset = useCallback(() => {
    if (node.type !== "split") return;
    distributePaneSplit(node.id);
  }, [distributePaneSplit, node]);

  if (node.type === "group") {
    if (hiddenPaneId && node.id === hiddenPaneId) {
      return <div className="h-full w-full bg-primary-bg" aria-hidden="true" />;
    }

    return <PaneContainer pane={node} />;
  }

  if (!flatEntries || flatEntries.length === 0) return null;

  const totalSize = flatEntries.reduce((sum, entry) => sum + entry.size, 0);
  const handleWidth = 4;
  const handleCount = flatEntries.length - 1;

  return (
    <div
      className={`flex h-full w-full ${isHorizontal ? "flex-row" : "flex-col"}`}
      data-pane-split-container="true"
    >
      {flatEntries.map((entry, index) => {
        const pct = (entry.size / totalSize) * 100;
        const handleDeduction = `${(handleWidth * handleCount) / flatEntries.length}px`;

        return (
          <div key={entry.node.id} className="contents">
            <div
              className="min-h-0 min-w-0 overflow-hidden"
              style={{
                [isHorizontal ? "width" : "height"]: `calc(${pct}% - ${handleDeduction})`,
              }}
            >
              {entry.node.type === "split" && entry.node.direction !== node.direction ? (
                <PaneNodeRenderer node={entry.node} hiddenPaneId={hiddenPaneId} />
              ) : entry.node.type === "group" ? (
                entry.node.id === hiddenPaneId ? (
                  <div className="h-full w-full bg-primary-bg" aria-hidden="true" />
                ) : (
                  <PaneContainer pane={entry.node} />
                )
              ) : (
                <PaneNodeRenderer node={entry.node} hiddenPaneId={hiddenPaneId} />
              )}
            </div>
            {index < flatEntries.length - 1 && (
              <FlatResizeHandle
                direction={node.direction}
                handleCount={handleCount}
                index={index}
                entries={flatEntries}
                onReset={handleFlatReset}
                onResize={handleFlatResize}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
