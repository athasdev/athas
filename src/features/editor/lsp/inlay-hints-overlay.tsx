import { type ForwardedRef, forwardRef, useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { InlayHint } from "./use-inlay-hints";

interface InlayHintsOverlayProps {
  hints: InlayHint[];
  fontSize: number;
  lineHeight: number;
  charWidth: number;
  contentOffsetLeft: number;
  scrollTop: number;
  viewportHeight: number;
}

const InlayHintsOverlay = forwardRef(
  (
    {
      hints,
      fontSize,
      lineHeight,
      charWidth,
      contentOffsetLeft,
      scrollTop,
      viewportHeight,
    }: InlayHintsOverlayProps,
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    // Only render hints visible in the viewport (with buffer)
    const visibleHints = useMemo(() => {
      const buffer = viewportHeight * 0.5;
      const startLine = Math.floor(Math.max(0, scrollTop - buffer) / lineHeight);
      const endLine = Math.ceil((scrollTop + viewportHeight + buffer) / lineHeight) + 1;
      return hints.filter((h) => h.line >= startLine && h.line <= endLine);
    }, [hints, scrollTop, viewportHeight, lineHeight]);

    if (visibleHints.length === 0) return null;

    return (
      <div
        ref={ref}
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 5 }}
      >
        {visibleHints.map((hint) => {
          const top = EDITOR_CONSTANTS.EDITOR_PADDING_TOP + hint.line * lineHeight;
          const left =
            contentOffsetLeft + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + hint.character * charWidth;

          return (
            <span
              key={`${hint.line}:${hint.character}:${hint.label}`}
              className="absolute inline-flex items-center rounded-sm border border-border/40 bg-primary-bg/95 editor-font text-text-lighter shadow-sm"
              style={{
                top: `${top}px`,
                left: `${left}px`,
                fontSize: `${fontSize * 0.85}px`,
                lineHeight: `${Math.max(12, lineHeight * 0.78)}px`,
                paddingLeft: hint.paddingLeft ? "3px" : "1px",
                paddingRight: hint.paddingRight ? "3px" : "1px",
                transform: "translateY(12%)",
              }}
            >
              {hint.label}
            </span>
          );
        })}
      </div>
    );
  },
);

InlayHintsOverlay.displayName = "InlayHintsOverlay";

export default InlayHintsOverlay;
