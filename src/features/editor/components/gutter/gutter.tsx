import { memo, useEffect, useRef, useState } from "react";
import { calculateTotalGutterWidth } from "../../utils/gutter";
import { DiagnosticIndicators } from "./diagnostic-indicators";
import { FoldIndicators } from "./fold-indicators";
import { GitIndicators } from "./git-indicators";
import { LineNumbers } from "./line-numbers";

interface LineMapping {
  actualToVirtual: Map<number, number>;
  virtualToActual: Map<number, number>;
  foldedRanges: Array<{ start: number; end: number; virtualLine: number }>;
}

interface GutterProps {
  totalLines: number;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  filePath?: string;
  onLineClick?: (lineNumber: number) => void;
  onGitIndicatorClick?: (lineNumber: number, type: "added" | "modified" | "deleted") => void;
  foldMapping?: LineMapping;
}

function GutterComponent({
  totalLines,
  fontSize,
  fontFamily,
  lineHeight,
  textareaRef,
  filePath,
  onLineClick,
  onGitIndicatorClick,
  foldMapping,
}: GutterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  const totalWidth = calculateTotalGutterWidth(totalLines);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const syncScroll = () => {
      setScrollOffset(textarea.scrollTop);
    };

    syncScroll();
    textarea.addEventListener("scroll", syncScroll);
    return () => textarea.removeEventListener("scroll", syncScroll);
  }, [textareaRef]);

  return (
    <div
      ref={containerRef}
      className="flex select-none bg-primary-bg"
      style={{
        width: `${totalWidth}px`,
        height: "100%",
        borderRight: "1px solid var(--border, rgba(255, 255, 255, 0.06))",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <div
        ref={contentRef}
        className="flex"
        style={{
          transform: `translateY(-${scrollOffset}px)`,
          willChange: "transform",
        }}
      >
        <GitIndicators
          totalLines={totalLines}
          lineHeight={lineHeight}
          fontSize={fontSize}
          fontFamily={fontFamily}
          onIndicatorClick={onGitIndicatorClick}
        />

        <DiagnosticIndicators
          filePath={filePath}
          totalLines={totalLines}
          lineHeight={lineHeight}
          fontSize={fontSize}
          fontFamily={fontFamily}
        />

        <LineNumbers
          totalLines={totalLines}
          lineHeight={lineHeight}
          fontSize={fontSize}
          fontFamily={fontFamily}
          onLineClick={onLineClick}
          foldMapping={foldMapping}
        />

        <FoldIndicators
          filePath={filePath}
          totalLines={totalLines}
          lineHeight={lineHeight}
          fontSize={fontSize}
          foldMapping={foldMapping}
        />
      </div>
    </div>
  );
}

GutterComponent.displayName = "Gutter";

export const Gutter = memo(GutterComponent, (prev, next) => {
  return (
    prev.totalLines === next.totalLines &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.textareaRef === next.textareaRef
  );
});
