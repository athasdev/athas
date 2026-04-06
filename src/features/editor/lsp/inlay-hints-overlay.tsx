import { useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { InlayHint } from "./use-inlay-hints";

interface InlayHintsOverlayProps {
  hints: InlayHint[];
  fontSize: number;
  charWidth: number;
  scrollTop: number;
  scrollLeft: number;
  viewportHeight: number;
}

const InlayHintsOverlay = ({
  hints,
  fontSize,
  charWidth,
  scrollTop,
  scrollLeft,
  viewportHeight,
}: InlayHintsOverlayProps) => {
  const lineHeight = Math.ceil(fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);

  // Only render hints visible in the viewport
  const visibleHints = useMemo(() => {
    const startLine = Math.floor(scrollTop / lineHeight);
    const endLine = Math.ceil((scrollTop + viewportHeight) / lineHeight) + 1;
    return hints.filter((h) => h.line >= startLine && h.line <= endLine);
  }, [hints, scrollTop, viewportHeight, lineHeight]);

  if (visibleHints.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 5 }}>
      {visibleHints.map((hint) => {
        const top = EDITOR_CONSTANTS.EDITOR_PADDING_TOP + hint.line * lineHeight - scrollTop;
        const left = EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + hint.character * charWidth - scrollLeft;

        return (
          <span
            key={`${hint.line}:${hint.character}:${hint.label}`}
            className="absolute inline-flex items-center rounded-sm bg-hover/50 font-mono text-text-lighter/70"
            style={{
              top: `${top}px`,
              left: `${left}px`,
              fontSize: `${fontSize * 0.85}px`,
              lineHeight: `${lineHeight}px`,
              paddingLeft: hint.paddingLeft ? "3px" : "1px",
              paddingRight: hint.paddingRight ? "3px" : "1px",
            }}
          >
            {hint.label}
          </span>
        );
      })}
    </div>
  );
};

export default InlayHintsOverlay;
