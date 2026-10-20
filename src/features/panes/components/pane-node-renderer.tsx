import { Fragment, useCallback, useMemo } from "react";
import { Pane } from "@/ui/pane";
import { usePaneStore } from "../stores/pane.store";
import type { PaneNode } from "../types/pane.types";
import { flattenPaneSplit, type FlatPaneEntry } from "../services/pane-tree";
import { PaneContainer } from "./pane-container";
import { PaneResizeHandle } from "./pane-resize-handle";
import { cn } from "@/utils/cn";

interface PaneNodeRendererProps {
  hiddenPaneId?: string | null;
  node: PaneNode;
  /**
   * Each pane group is its own raised island and splits are the workbench gutter, as in the
   * centre. Without it the groups share the surface they sit on and splits are a hairline.
   */
  islands?: boolean;
}

interface FlatResizeHandleProps {
  appearance: "line" | "gap";
  direction: "horizontal" | "vertical";
  handleCount: number;
  index: number;
  entries: FlatPaneEntry[];
  onReset: (index: number) => void;
  onResize: (index: number, sizes: [number, number]) => void;
}

function FlatResizeHandle({
  appearance,
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
      appearance={appearance}
      direction={direction}
      onResize={handleResize}
      onReset={handleReset}
      initialSizes={initialSizes}
      resizeHandleCount={handleCount}
    />
  );
}

function PaneGroupView({
  pane,
  hidden,
  island,
}: {
  pane: Extract<PaneNode, { type: "group" }>;
  hidden: boolean;
  island: boolean;
}) {
  const content = hidden ? (
    <div className="size-full bg-background" aria-hidden="true" />
  ) : (
    <PaneContainer pane={pane} />
  );
  if (!island) return content;
  return (
    <Pane surface="island" data-pane-island={pane.id} className="size-full">
      {content}
    </Pane>
  );
}

export function PaneNodeRenderer({
  node,
  hiddenPaneId = null,
  islands = false,
}: PaneNodeRendererProps) {
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
    return <PaneGroupView pane={node} hidden={node.id === hiddenPaneId} island={islands} />;
  }

  if (!flatEntries || flatEntries.length === 0) return null;

  const handleCount = flatEntries.length - 1;

  return (
    <div
      className={`flex size-full ${isHorizontal ? "flex-row" : "flex-col"}`}
      data-pane-split-container="true"
    >
      {flatEntries.map((entry, index) => {
        return (
          <Fragment key={entry.node.id}>
            <div
              // An island's ring and shadow paint outside its box, so its slot must not clip.
              className={cn("min-h-0 min-w-0", !islands && "overflow-hidden")}
              style={{
                flexBasis: 0,
                flexGrow: entry.size,
              }}
            >
              {entry.node.type === "group" ? (
                <PaneGroupView
                  pane={entry.node}
                  hidden={entry.node.id === hiddenPaneId}
                  island={islands}
                />
              ) : (
                <PaneNodeRenderer node={entry.node} hiddenPaneId={hiddenPaneId} islands={islands} />
              )}
            </div>
            {index < flatEntries.length - 1 && (
              <FlatResizeHandle
                appearance={islands ? "gap" : "line"}
                direction={node.direction}
                handleCount={handleCount}
                index={index}
                entries={flatEntries}
                onReset={handleFlatReset}
                onResize={handleFlatResize}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
