import { useCallback, useMemo } from "react";
import { usePaneStore } from "../stores/pane-store";
import type { PaneNode, PaneSplit } from "../types/pane";
import { PaneContainer } from "./pane-container";
import { PaneResizeHandle } from "./pane-resize-handle";

interface FlatEntry {
  node: PaneNode;
  size: number;
  path: Array<{ splitId: string; childIndex: 0 | 1 }>;
}

function flattenSplit(
  split: PaneSplit,
  parentSize: number,
  path: Array<{ splitId: string; childIndex: 0 | 1 }>,
): FlatEntry[] {
  const entries: FlatEntry[] = [];

  for (let i = 0; i < 2; i++) {
    const child = split.children[i as 0 | 1];
    const childSize = (split.sizes[i as 0 | 1] / 100) * parentSize;
    const childPath = [...path, { splitId: split.id, childIndex: i as 0 | 1 }];

    if (child.type === "split" && child.direction === split.direction) {
      entries.push(...flattenSplit(child, childSize, childPath));
    } else {
      entries.push({ node: child, size: childSize, path: childPath });
    }
  }

  return entries;
}

function writeFlatSizesToTree(
  entries: FlatEntry[],
  updateFn: (splitId: string, sizes: [number, number]) => void,
) {
  const splitTotals = new Map<string, { first: number; second: number }>();

  for (const entry of entries) {
    for (const step of entry.path) {
      if (!splitTotals.has(step.splitId)) {
        splitTotals.set(step.splitId, { first: 0, second: 0 });
      }
    }
  }

  for (const entry of entries) {
    for (const step of entry.path) {
      const totals = splitTotals.get(step.splitId)!;
      if (step.childIndex === 0) {
        totals.first += entry.size;
      } else {
        totals.second += entry.size;
      }
    }
  }

  for (const [splitId, totals] of splitTotals) {
    const sum = totals.first + totals.second;
    if (sum <= 0) continue;
    updateFn(splitId, [(totals.first / sum) * 100, (totals.second / sum) * 100]);
  }
}

interface PaneNodeRendererProps {
  hiddenPaneId?: string | null;
  node: PaneNode;
}

interface FlatResizeHandleProps {
  direction: "horizontal" | "vertical";
  index: number;
  entries: FlatEntry[];
  onResize: (index: number, sizes: [number, number]) => void;
}

function FlatResizeHandle({ direction, index, entries, onResize }: FlatResizeHandleProps) {
  const handleResize = useCallback(
    (sizes: [number, number]) => {
      onResize(index, sizes);
    },
    [index, onResize],
  );

  const initialSizes: [number, number] = [entries[index].size, entries[index + 1].size];

  return (
    <PaneResizeHandle direction={direction} onResize={handleResize} initialSizes={initialSizes} />
  );
}

export function PaneNodeRenderer({ node, hiddenPaneId = null }: PaneNodeRendererProps) {
  const { updatePaneSizes } = usePaneStore.use.actions();
  const isHorizontal = node.type === "split" ? node.direction === "horizontal" : false;

  const flatEntries = useMemo(() => {
    if (node.type !== "split") return null;
    return flattenSplit(node, 100, []);
  }, [node]);

  const handleFlatResize = useCallback(
    (index: number, sizes: [number, number]) => {
      if (!flatEntries) return;

      const nextSizes = flatEntries.map((entry) => entry.size);
      nextSizes[index] = sizes[0];
      nextSizes[index + 1] = sizes[1];

      const updatedEntries = flatEntries.map((entry, entryIndex) => ({
        ...entry,
        size: nextSizes[entryIndex],
      }));

      writeFlatSizesToTree(updatedEntries, (splitId, splitSizes) => {
        updatePaneSizes(splitId, splitSizes);
      });
    },
    [flatEntries, updatePaneSizes],
  );

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
    <div className={`flex h-full w-full ${isHorizontal ? "flex-row" : "flex-col"}`}>
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
                index={index}
                entries={flatEntries}
                onResize={handleFlatResize}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
