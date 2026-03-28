import { useCallback, useEffect, useMemo } from "react";
import { IS_MAC } from "@/utils/platform";
import { usePaneStore } from "../stores/pane-store";
import type { PaneNode, PaneSplit } from "../types/pane";
import {
  getAllPaneGroups,
  getCollapsedSplitRepairs,
  normalizePanePairSizes,
} from "../utils/pane-tree";
import { PaneContainer } from "./pane-container";
import { PaneResizeHandle } from "./pane-resize-handle";

interface FlatEntry {
  node: PaneNode;
  size: number;
  // Path of {splitId, childIndex} pairs to write size back into the tree
  path: Array<{ splitId: string; childIndex: 0 | 1 }>;
}

/**
 * Flatten a split node: recursively expand children that share the same
 * direction into a flat list with absolute percentage sizes.
 */
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

/**
 * Given a flat list of sizes, write them back into the tree by walking
 * each entry's path bottom-up and computing the binary split ratios.
 */
function writeFlatSizesToTree(
  entries: FlatEntry[],
  updateFn: (splitId: string, sizes: [number, number]) => void,
) {
  // Group entries by their parent splitId at each level.
  // We need to compute, for each split node, what its two children's total sizes are.
  const splitTotals = new Map<string, { first: number; second: number }>();

  for (const entry of entries) {
    for (const step of entry.path) {
      if (!splitTotals.has(step.splitId)) {
        splitTotals.set(step.splitId, { first: 0, second: 0 });
      }
    }
  }

  // For each entry, accumulate its size into each ancestor split
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

  // Now convert totals to percentages and update each split
  for (const [splitId, totals] of splitTotals) {
    const sum = totals.first + totals.second;
    if (sum > 0) {
      const firstPct = (totals.first / sum) * 100;
      const secondPct = (totals.second / sum) * 100;
      updateFn(splitId, [firstPct, secondPct]);
    }
  }
}

interface PaneNodeRendererProps {
  node: PaneNode;
}

function PaneNodeRenderer({ node }: PaneNodeRendererProps) {
  const { updatePaneSizes } = usePaneStore.use.actions();

  const isHorizontal = node.type === "split" ? node.direction === "horizontal" : false;

  // Flatten same-direction splits into a single flex container
  const flatEntries = useMemo(() => {
    if (node.type !== "split") return null;
    return flattenSplit(node, 100, []);
  }, [node]);

  const handleFlatResize = useCallback(
    (index: number, sizes: [number, number]) => {
      if (!flatEntries) return;

      // Clone the sizes
      const newSizes = flatEntries.map((e) => e.size);
      newSizes[index] = sizes[0];
      newSizes[index + 1] = sizes[1];

      // Build updated entries with new sizes
      const updatedEntries = flatEntries.map((e, i) => ({ ...e, size: newSizes[i] }));

      // Write back to tree
      writeFlatSizesToTree(updatedEntries, (splitId, splitSizes) => {
        updatePaneSizes(splitId, splitSizes);
      });
    },
    [flatEntries, updatePaneSizes],
  );

  const handleFlatResizeEnd = useCallback(
    (index: number, sizes: [number, number]) => {
      if (!flatEntries) return;

      const repairedSizes = normalizePanePairSizes(sizes);
      const newSizes = flatEntries.map((entry) => entry.size);
      newSizes[index] = repairedSizes[0];
      newSizes[index + 1] = repairedSizes[1];

      const updatedEntries = flatEntries.map((entry, entryIndex) => ({
        ...entry,
        size: newSizes[entryIndex],
      }));

      writeFlatSizesToTree(updatedEntries, (splitId, splitSizes) => {
        updatePaneSizes(splitId, splitSizes);
      });
    },
    [flatEntries, updatePaneSizes],
  );

  if (node.type === "group") {
    return <PaneContainer pane={node} />;
  }

  if (!flatEntries || flatEntries.length === 0) return null;

  // If only 2 entries (no flattening benefit), still use the flat approach for consistency
  const totalSize = flatEntries.reduce((sum, e) => sum + e.size, 0);
  const handleWidth = 1; // w-px = 1px
  const handleCount = flatEntries.length - 1;

  return (
    <div className={`flex h-full w-full ${isHorizontal ? "flex-row" : "flex-col"}`}>
      {flatEntries.map((entry, i) => {
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
                <PaneNodeRenderer node={entry.node} />
              ) : entry.node.type === "group" ? (
                <PaneContainer pane={entry.node} />
              ) : (
                <PaneNodeRenderer node={entry.node} />
              )}
            </div>
            {i < flatEntries.length - 1 && (
              <FlatResizeHandle
                direction={node.direction}
                index={i}
                entries={flatEntries}
                onResize={handleFlatResize}
                onResizeEnd={handleFlatResizeEnd}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface FlatResizeHandleProps {
  direction: "horizontal" | "vertical";
  index: number;
  entries: FlatEntry[];
  onResize: (index: number, sizes: [number, number]) => void;
  onResizeEnd: (index: number, sizes: [number, number]) => void;
}

function FlatResizeHandle({
  direction,
  index,
  entries,
  onResize,
  onResizeEnd,
}: FlatResizeHandleProps) {
  const handleResize = useCallback(
    (sizes: [number, number]) => {
      onResize(index, sizes);
    },
    [index, onResize],
  );

  const handleResizeEnd = useCallback(
    (sizes: [number, number]) => {
      onResizeEnd(index, sizes);
    },
    [index, onResizeEnd],
  );

  const initialSizes: [number, number] = [entries[index].size, entries[index + 1].size];

  return (
    <PaneResizeHandle
      direction={direction}
      onResize={handleResize}
      onResizeEnd={handleResizeEnd}
      initialSizes={initialSizes}
    />
  );
}

export function SplitViewRoot() {
  const root = usePaneStore.use.root();
  const fullscreenPaneId = usePaneStore.use.fullscreenPaneId();
  const { exitPaneFullscreen, updatePaneSizes } = usePaneStore.use.actions();
  const collapsedSplitRepairs = useMemo(() => getCollapsedSplitRepairs(root), [root]);
  const fullscreenPane = useMemo(
    () =>
      fullscreenPaneId
        ? (getAllPaneGroups(root).find((pane) => pane.id === fullscreenPaneId) ?? null)
        : null,
    [fullscreenPaneId, root],
  );

  useEffect(() => {
    if (fullscreenPaneId && !fullscreenPane) {
      exitPaneFullscreen();
    }
  }, [exitPaneFullscreen, fullscreenPane, fullscreenPaneId]);

  useEffect(() => {
    if (collapsedSplitRepairs.length === 0) return;

    collapsedSplitRepairs.forEach(({ splitId, sizes }) => {
      updatePaneSizes(splitId, sizes);
    });
  }, [collapsedSplitRepairs, updatePaneSizes]);

  const titleBarHeight = IS_MAC ? 44 : 28;
  const footerHeight = 32;

  return (
    <>
      <div className="h-full w-full overflow-hidden">
        <PaneNodeRenderer node={root} />
      </div>

      {fullscreenPane && (
        <div
          className="fixed inset-x-2 z-[10040]"
          style={{
            top: `${titleBarHeight + 8}px`,
            bottom: `${footerHeight + 8}px`,
          }}
        >
          <div className="h-full overflow-hidden rounded-xl border border-border/80 bg-primary-bg shadow-2xl">
            <PaneContainer pane={fullscreenPane} />
          </div>
        </div>
      )}
    </>
  );
}
