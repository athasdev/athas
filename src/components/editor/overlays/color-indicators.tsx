import { memo, useEffect, useState } from "react";
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
  const { scrollTop, scrollLeft } = useEditorLayoutStore();

  // Detect colors in the content
  useEffect(() => {
    if (!content) {
      setColors([]);
      return;
    }

    // Debounce color detection to avoid excessive computation
    const timeoutId = setTimeout(() => {
      const detectedColors = detectColors(content);
      setColors(detectedColors);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [content]);

  if (colors.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {colors.map((color, index) => (
        <ColorIndicator
          key={`${color.start}-${color.end}-${index}`}
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
