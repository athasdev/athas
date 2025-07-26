import { memo, useEffect, useRef } from "react";
import { useEditorInteractions } from "../../../hooks/use-editor-interactions";
import { useEditorLayout } from "../../../hooks/use-editor-layout";
import { useEditorCursorStore } from "../../../stores/editor-cursor-store";
import { useEditorLayoutStore } from "../../../stores/editor-layout-store";
import { useEditorSettingsStore } from "../../../stores/editor-settings-store";
import type { Position } from "../../../types/editor-types";
import { Cursor } from "../overlays/cursor";
import { DecorationLayer } from "../overlays/decoration-layer";
import { EditorViewport } from "../rendering/editor-viewport";
import { EditorLayer, EditorLayers } from "./editor-layers";
import "../../../styles/editor-line-based.css";
import "../../../styles/token-theme.css";

interface LineBasedEditorProps {
  onPositionClick?: (position: Position) => void;
  onSelectionDrag?: (start: Position, end: Position) => void;
  viewportRef?: React.MutableRefObject<HTMLDivElement | null>;
}

export const LineBasedEditor = memo<LineBasedEditorProps>(
  ({ onPositionClick, onSelectionDrag, viewportRef }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const internalViewportRef = useRef<HTMLDivElement>(null);

    const fontSize = useEditorSettingsStore.use.fontSize();
    const { scrollTop, scrollLeft, viewportHeight } = useEditorLayoutStore();
    const { setScroll } = useEditorLayoutStore.use.actions();
    const { lineHeight, gutterWidth } = useEditorLayout();

    const { handleClick, handleMouseDown, handleMouseMove, handleMouseUp } = useEditorInteractions({
      lineHeight,
      fontSize,
      gutterWidth,
      onPositionClick,
      onSelectionDrag,
    });

    // Subscribe to cursor line changes only
    useEffect(() => {
      const unsubscribe = useEditorCursorStore.subscribe(
        (state) => state.cursorPosition.line,
        (cursorLine) => {
          const cursorTop = cursorLine * lineHeight;
          const cursorBottom = cursorTop + lineHeight;

          if (cursorTop < scrollTop) {
            setScroll(cursorTop, scrollLeft);
          } else if (cursorBottom > scrollTop + viewportHeight) {
            setScroll(cursorBottom - viewportHeight, scrollLeft);
          }
        },
      );
      return unsubscribe;
    }, [lineHeight, scrollTop, scrollLeft, viewportHeight, setScroll]);

    const handleScroll = (newScrollTop: number, newScrollLeft: number) => {
      setScroll(newScrollTop, newScrollLeft);
    };

    // Store viewport ref for parent access
    useEffect(() => {
      if (viewportRef && internalViewportRef.current) {
        viewportRef.current = internalViewportRef.current;
      }
    }, [viewportRef]);

    return (
      <div
        ref={containerRef}
        className="editor-content-new"
        style={{
          position: "relative",
          width: "100%",
          height: `${viewportHeight}px`,
          overflow: "hidden",
          fontSize: `${fontSize}px`,
          fontFamily: "JetBrains Mono, monospace",
        }}
      >
        <EditorLayers>
          <EditorLayer type="base">
            <EditorViewport
              ref={internalViewportRef}
              onScroll={handleScroll}
              onClick={handleClick}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            />
          </EditorLayer>
          <EditorLayer type="decoration">
            <DecorationLayer />
          </EditorLayer>
          <EditorLayer type="overlay">
            <Cursor />
          </EditorLayer>
        </EditorLayers>
      </div>
    );
  },
);

LineBasedEditor.displayName = "LineBasedEditor";
