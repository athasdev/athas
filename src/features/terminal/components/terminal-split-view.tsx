import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { PaneResizeHandle } from "@/features/panes/components/pane-resize-handle";
import type { PaneNode, PaneSplit } from "@/features/panes/types/pane.types";
import { flattenPaneSplit } from "@/features/panes/utils/pane-tree";
import { cn } from "@/utils/cn";

interface TerminalSplitViewProps {
  layout: PaneNode;
  activeTerminalId: string | null;
  renderTerminal: (terminalId: string) => ReactNode;
  onActivate: (terminalId: string) => void;
  onResize: (splitId: string, index: number, sizes: [number, number]) => void;
  onDistribute: (splitId: string) => void;
}

interface SplitHandleProps {
  split: PaneSplit;
  index: number;
  sizes: [number, number];
  handleCount: number;
  onResize: TerminalSplitViewProps["onResize"];
  onDistribute: TerminalSplitViewProps["onDistribute"];
}

function SplitHandle({
  split,
  index,
  sizes,
  handleCount,
  onResize,
  onDistribute,
}: SplitHandleProps) {
  const handleResize = useCallback(
    (next: [number, number]) => onResize(split.id, index, next),
    [index, onResize, split.id],
  );
  const handleReset = useCallback(() => onDistribute(split.id), [onDistribute, split.id]);

  return (
    <PaneResizeHandle
      direction={split.direction}
      onResize={handleResize}
      onReset={handleReset}
      initialSizes={sizes}
      resizeHandleCount={handleCount}
    />
  );
}

interface TerminalSplitLeafProps {
  terminalId: string;
  isActive: boolean;
  onActivate: (terminalId: string) => void;
  children: ReactNode;
}

// The xterm DOM lives in a portal, so React's synthetic events from inside the
// terminal never bubble through this wrapper. A native capture listener does.
function TerminalSplitLeaf({ terminalId, isActive, onActivate, children }: TerminalSplitLeafProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || isActive) return;
    const handleMouseDown = () => onActivate(terminalId);
    element.addEventListener("mousedown", handleMouseDown, true);
    return () => element.removeEventListener("mousedown", handleMouseDown, true);
  }, [isActive, onActivate, terminalId]);

  return (
    <div
      ref={ref}
      className="size-full min-h-0 min-w-0"
      data-terminal-pane={terminalId}
      data-active={isActive ? "true" : undefined}
    >
      {children}
    </div>
  );
}

export function TerminalSplitView({
  layout,
  activeTerminalId,
  renderTerminal,
  onActivate,
  onResize,
  onDistribute,
}: TerminalSplitViewProps) {
  const entries = useMemo(
    () => (layout.type === "split" ? flattenPaneSplit(layout) : null),
    [layout],
  );

  if (layout.type === "group") {
    const terminalId = layout.bufferIds[0];
    if (!terminalId) return null;
    return (
      <TerminalSplitLeaf
        terminalId={terminalId}
        isActive={terminalId === activeTerminalId}
        onActivate={onActivate}
      >
        {renderTerminal(terminalId)}
      </TerminalSplitLeaf>
    );
  }

  if (!entries || entries.length === 0) return null;
  const handleCount = entries.length - 1;

  return (
    <div
      className={cn("flex size-full", layout.direction === "horizontal" ? "flex-row" : "flex-col")}
      data-pane-split-container="true"
    >
      {entries.map((entry, index) => (
        <Fragment key={entry.node.id}>
          <div
            className="min-h-0 min-w-0 overflow-hidden"
            style={{ flexBasis: 0, flexGrow: entry.size }}
          >
            <TerminalSplitView
              layout={entry.node}
              activeTerminalId={activeTerminalId}
              renderTerminal={renderTerminal}
              onActivate={onActivate}
              onResize={onResize}
              onDistribute={onDistribute}
            />
          </div>
          {index < handleCount ? (
            <SplitHandle
              split={layout}
              index={index}
              sizes={[entry.size, entries[index + 1].size]}
              handleCount={handleCount}
              onResize={onResize}
              onDistribute={onDistribute}
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
