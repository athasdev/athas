import { forwardRef, memo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { ViewPosition } from "@/features/athas-editor/view-model/view-layout";

interface CurrentLineLayerProps {
  visualLine: number;
  lineHeight: number;
  cursorViewPosition?: ViewPosition;
  hidden?: boolean;
}

const CurrentLineLayerComponent = forwardRef<HTMLDivElement, CurrentLineLayerProps>(
  ({ visualLine, lineHeight, cursorViewPosition, hidden = false }, ref) => {
    if (hidden || visualLine < 0) return null;

    const top =
      cursorViewPosition?.segment.top ??
      visualLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
    const height = cursorViewPosition?.segment.height ?? lineHeight;

    return (
      <div
        ref={ref}
        data-editor-scroll-axis="y"
        className="current-line-layer pointer-events-none absolute inset-0 z-0"
        style={{ willChange: "transform" }}
      >
        <div
          className="editor-current-line"
          style={{
            top: `${top}px`,
            height: `${height}px`,
          }}
        />
      </div>
    );
  },
);

CurrentLineLayerComponent.displayName = "CurrentLineLayer";

export const CurrentLineLayer = memo(CurrentLineLayerComponent, (prev, next) => {
  return (
    prev.visualLine === next.visualLine &&
    prev.lineHeight === next.lineHeight &&
    prev.cursorViewPosition === next.cursorViewPosition &&
    prev.hidden === next.hidden
  );
});
