import { useCallback } from "react";
import { usePaneStore } from "../stores/pane-store";
import type { PaneNode } from "../types/pane";
import { PaneContainer } from "./pane-container";
import { PaneResizeHandle } from "./pane-resize-handle";

interface PaneNodeRendererProps {
  node: PaneNode;
}

function PaneNodeRenderer({ node }: PaneNodeRendererProps) {
  const { updatePaneSizes } = usePaneStore.use.actions();

  const handleResize = useCallback(
    (sizes: [number, number]) => {
      if (node.type === "split") {
        updatePaneSizes(node.id, sizes);
      }
    },
    [node, updatePaneSizes],
  );

  if (node.type === "group") {
    return <PaneContainer pane={node} />;
  }

  const isHorizontal = node.direction === "horizontal";

  return (
    <div className={`flex h-full w-full ${isHorizontal ? "flex-row" : "flex-col"}`}>
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{
          [isHorizontal ? "width" : "height"]: `${node.sizes[0]}%`,
        }}
      >
        <PaneNodeRenderer node={node.children[0]} />
      </div>
      <PaneResizeHandle
        direction={node.direction}
        onResize={handleResize}
        initialSizes={node.sizes}
      />
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{
          [isHorizontal ? "width" : "height"]: `${node.sizes[1]}%`,
        }}
      >
        <PaneNodeRenderer node={node.children[1]} />
      </div>
    </div>
  );
}

export function SplitViewRoot() {
  const root = usePaneStore.use.root();

  return (
    <div className="h-full w-full overflow-hidden">
      <PaneNodeRenderer node={root} />
    </div>
  );
}
