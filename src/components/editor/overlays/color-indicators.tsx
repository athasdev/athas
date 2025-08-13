import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useEditorLayoutStore } from "@/stores/editor-layout-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { type ColorMatch, detectColors } from "@/utils/color-detection";

interface ColorIndicatorProps {
  color: ColorMatch;
  lineHeight: number;
  charWidth: number;
  scrollTop: number;
  scrollLeft: number;
  gutterWidth: number;
}

const ColorIndicator = memo<ColorIndicatorProps>(
  ({ color, lineHeight, charWidth, scrollTop, scrollLeft, gutterWidth }) => {
    // Calculate the position of the indicator
    const top = color.line * lineHeight - scrollTop;
    const left = gutterWidth + 8 + (color.column + color.value.length) * charWidth - scrollLeft;

    // Only render if visible in viewport
    if (top < -20 || top > window.innerHeight + 20) {
      return null;
    }

    return (
      <div
        className="pointer-events-none absolute flex items-center justify-center"
        style={{
          top: `${top + (lineHeight - 12) / 2}px`, // Center vertically with line height
          left: `${left + 8}px`, // Margin between color value and indicator
          zIndex: 10,
        }}
      >
        <div
          className="h-3 w-3 rounded border border-gray-400 shadow-sm"
          style={{
            backgroundColor: color.normalizedValue,
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
          }}
          title={`${color.value} → ${color.normalizedValue}`}
        />
      </div>
    );
  },
);

ColorIndicator.displayName = "ColorIndicator";

export const ColorIndicators = memo(() => {
  const [colors, setColors] = useState<ColorMatch[]>([]);
  const { getContent } = useEditorViewStore.use.actions();
  const content = getContent();
  const { lineHeight, charWidth, gutterWidth } = useEditorLayout();
  const { scrollTop, scrollLeft, viewportHeight } = useEditorLayoutStore();

  const contentHashRef = useRef<string>("");
  const detectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Memoized color detection with content hash check
  const detectColorsThrottled = useCallback((newContent: string) => {
    const contentHash = newContent.slice(0, 100) + newContent.length; // Simple hash
    if (contentHashRef.current === contentHash) return;

    contentHashRef.current = contentHash;

    if (detectionTimeoutRef.current) {
      clearTimeout(detectionTimeoutRef.current);
    }

    detectionTimeoutRef.current = setTimeout(() => {
      const detectedColors = detectColors(newContent);
      setColors(detectedColors);
    }, 200); // Increased debounce for better performance
  }, []);

  // Detect colors in the content
  useEffect(() => {
    if (!content) {
      setColors([]);
      contentHashRef.current = "";
      return;
    }

    detectColorsThrottled(content);

    return () => {
      if (detectionTimeoutRef.current) {
        clearTimeout(detectionTimeoutRef.current);
      }
    };
  }, [content, detectColorsThrottled]);

  // Filter visible colors for performance
  const visibleColors = useMemo(() => {
    if (colors.length === 0) return [];

    const startLine = Math.floor(scrollTop / lineHeight) - 5; // Buffer lines
    const endLine = Math.ceil((scrollTop + viewportHeight) / lineHeight) + 5;

    return colors.filter((color) => color.line >= startLine && color.line <= endLine);
  }, [colors, scrollTop, lineHeight, viewportHeight]);

  if (visibleColors.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {visibleColors.map((color) => (
        <ColorIndicator
          key={`${color.start}-${color.end}`}
          color={color}
          lineHeight={lineHeight}
          charWidth={charWidth}
          scrollTop={scrollTop}
          scrollLeft={scrollLeft}
          gutterWidth={gutterWidth}
        />
      ))}
    </div>
  );
});

ColorIndicators.displayName = "ColorIndicators";
