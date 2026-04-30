import { type ForwardedRef, forwardRef, useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { CodeLensItem } from "./use-code-lens";

interface CodeLensOverlayProps {
  lenses: CodeLensItem[];
  fontSize: number;
  lineHeight: number;
  scrollTop: number;
  viewportHeight: number;
  onExecute?: (lens: CodeLensItem) => void;
}

const CodeLensOverlay = forwardRef(
  (
    { lenses, fontSize, lineHeight, scrollTop, viewportHeight, onExecute }: CodeLensOverlayProps,
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    // Group lenses by line and only render visible ones
    const visibleGroups = useMemo(() => {
      const buffer = viewportHeight * 0.5;
      const startLine = Math.floor(Math.max(0, scrollTop - buffer) / lineHeight);
      const endLine = Math.ceil((scrollTop + viewportHeight + buffer) / lineHeight) + 1;

      const byLine = new Map<number, CodeLensItem[]>();
      for (const lens of lenses) {
        if (lens.line < startLine || lens.line > endLine) continue;
        const existing = byLine.get(lens.line) || [];
        existing.push(lens);
        byLine.set(lens.line, existing);
      }
      return byLine;
    }, [lenses, scrollTop, viewportHeight, lineHeight]);

    if (visibleGroups.size === 0) return null;

    return (
      <div ref={ref} className="absolute inset-0 overflow-hidden" style={{ zIndex: 4 }}>
        {Array.from(visibleGroups.entries()).map(([line, items]) => {
          const top = EDITOR_CONSTANTS.EDITOR_PADDING_TOP + line * lineHeight - lineHeight * 0.2;
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
