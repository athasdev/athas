import { type ForwardedRef, forwardRef, useEffect, useMemo, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { EditorModelPositionResolver } from "../view-model/view-layout";
import type { CodeLensItem } from "./use-code-lens";

interface CodeLensOverlayProps {
  lenses: CodeLensItem[];
  fontSize: number;
  lineHeight: number;
  scrollTop: number;
  viewportHeight: number;
  onExecute?: (lens: CodeLensItem) => void;
  resolveModelPosition?: EditorModelPositionResolver;
}

const CodeLensOverlay = forwardRef(
  (
    {
      lenses,
      fontSize,
      lineHeight,
      scrollTop,
      viewportHeight,
      onExecute,
      resolveModelPosition,
    }: CodeLensOverlayProps,
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    const [resolvedTops, setResolvedTops] = useState<Map<number, number>>(new Map());

    useEffect(() => {
      if (!resolveModelPosition || lenses.length === 0) {
        setResolvedTops(new Map());
        return;
      }

      const nextTops = new Map<number, number>();
      for (const line of new Set(lenses.map((lens) => lens.line))) {
        const resolvedTop = resolveModelPosition(line, 0)?.top;
        if (typeof resolvedTop === "number") {
          nextTops.set(line, resolvedTop);
        }
      }

      setResolvedTops(nextTops);
    }, [lenses, resolveModelPosition]);

    // Group lenses by line and only render visible ones
    const visibleGroups = useMemo(() => {
      const buffer = viewportHeight * 0.5;
      const visibleTop = Math.max(0, scrollTop - buffer);
      const visibleBottom = scrollTop + viewportHeight + buffer;

      const byLine = new Map<number, CodeLensItem[]>();
      for (const lens of lenses) {
        const top =
          resolvedTops.get(lens.line) ??
          EDITOR_CONSTANTS.EDITOR_PADDING_TOP + lens.line * lineHeight;
        if (top < visibleTop || top > visibleBottom) continue;
        const existing = byLine.get(lens.line) || [];
        existing.push(lens);
        byLine.set(lens.line, existing);
      }
      return byLine;
    }, [lenses, scrollTop, viewportHeight, lineHeight, resolvedTops]);

    if (visibleGroups.size === 0) return null;

    return (
      <div ref={ref} className="absolute inset-0 overflow-hidden" style={{ zIndex: 4 }}>
        {Array.from(visibleGroups.entries()).map(([line, items]) => {
          const top =
            (resolvedTops.get(line) ?? EDITOR_CONSTANTS.EDITOR_PADDING_TOP + line * lineHeight) -
            lineHeight * 0.2;
          const left = EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;

          return (
            <div
              key={line}
              className="absolute"
              style={{
                top: `${top}px`,
                left: `${left}px`,
                fontSize: `${fontSize * 0.8}px`,
                lineHeight: `${lineHeight * 0.8}px`,
              }}
            >
              {items.map((item, i) => (
                <button
                  key={`${item.title}-${i}`}
                  type="button"
                  className="mr-2 cursor-pointer border-none bg-transparent p-0 editor-font text-text-lighter/60 hover:text-text"
                  disabled={!item.command}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (item.command) onExecute?.(item);
                  }}
                >
                  {item.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    );
  },
);

CodeLensOverlay.displayName = "CodeLensOverlay";

export default CodeLensOverlay;
