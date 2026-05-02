import { memo, useMemo } from "react";
import { useDebuggerStore } from "@/features/debugger/stores/debugger-store";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";

interface DebugBreakpointIndicatorsProps {
  filePath?: string;
  lineHeight: number;
  startLine: number;
  endLine: number;
  hiddenLines?: Set<number>;
}

function DebugBreakpointIndicatorsComponent({
  filePath,
  lineHeight,
  startLine,
  endLine,
  hiddenLines,
}: DebugBreakpointIndicatorsProps) {
  const breakpoints = useDebuggerStore.use.breakpoints();
  const { toggleBreakpoint } = useDebuggerStore.use.actions();

  const breakpointsByLine = useMemo(() => {
    const result = new Map<number, boolean>();
    if (!filePath) return result;

    for (const breakpoint of breakpoints) {
      if (breakpoint.filePath === filePath) {
        result.set(breakpoint.line, breakpoint.enabled);
      }
    }

    return result;
  }, [breakpoints, filePath]);

  const indicators = useMemo(() => {
    const items: React.ReactNode[] = [];

    for (let lineNum = startLine; lineNum < endLine; lineNum++) {
      if (hiddenLines?.has(lineNum)) continue;
      const enabled = breakpointsByLine.get(lineNum);
      const hasBreakpoint = typeof enabled === "boolean";

      items.push(
        <button
          key={`debug-bp-${lineNum}`}
          type="button"
          aria-label={`${hasBreakpoint ? "Remove" : "Add"} breakpoint on line ${lineNum + 1}`}
          style={{
            position: "absolute",
            top: `${lineNum * lineHeight + EDITOR_CONSTANTS.GUTTER_PADDING}px`,
            left: 0,
            right: 0,
            height: `${lineHeight}px`,
          }}
          className="group flex items-center justify-center"
          onClick={(event) => {
            event.stopPropagation();
            if (filePath) toggleBreakpoint(filePath, lineNum);
          }}
        >
          <span
            className={
              hasBreakpoint
                ? enabled
                  ? "size-2.5 rounded-full bg-error"
                  : "size-2.5 rounded-full border border-error"
                : "size-2.5 rounded-full bg-text-lighter/0 transition-colors group-hover:bg-text-lighter/30"
            }
          />
        </button>,
      );
    }

    return items;
  }, [breakpointsByLine, endLine, filePath, hiddenLines, lineHeight, startLine, toggleBreakpoint]);

  return (
    <div
      style={{
        position: "relative",
        width: "14px",
        zIndex: 3,
      }}
    >
      {indicators}
    </div>
  );
}

export const DebugBreakpointIndicators = memo(DebugBreakpointIndicatorsComponent);
