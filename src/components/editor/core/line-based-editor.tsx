import { memo, useEffect, useRef } from "react";
import { useEditorInteractions } from "@/hooks/use-editor-interactions";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useEditorLayoutStore } from "@/stores/editor-layout-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import type { Position } from "@/types/editor-types";
import { ColorIndicators } from "../overlays/color-indicators";
import { Cursor } from "../overlays/cursor";
import { DecorationLayer } from "../overlays/decoration-layer";
import { EditorViewport } from "../rendering/editor-viewport";
import { EditorLayer, EditorLayers } from "./editor-layers";
import "@/styles/editor-line-based.css";
import "@/styles/token-theme.css";

interface LineBasedEditorProps {
  onPositionClick?: (position: Position) => void;
  onSelectionDrag?: (start: Position, end: Position) => void;
  viewportRef?: React.MutableRefObject<HTMLDivElement | null>;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const LineBasedEditor = memo<LineBasedEditorProps>(
  ({ onPositionClick, onSelectionDrag, viewportRef, onContextMenu }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const internalViewportRef = useRef<HTMLDivElement>(null);

    const fontSize = useEditorSettingsStore.use.fontSize();
    const { viewportHeight } = useEditorLayoutStore();
    const { setScroll } = useEditorLayoutStore.use.actions();
    const { lineHeight, gutterWidth } = useEditorLayout();

    const { handleClick, handleMouseDown, handleMouseMove, handleMouseUp } = useEditorInteractions({
      lineHeight,
      fontSize,
      gutterWidth,
      onPositionClick,
      onSelectionDrag,
    });

    // Removed cursor line subscription - scrolling is now handled directly in editor-api.ts
    // This simplifies the flow and prevents circular updates

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
          lineHeight: `${lineHeight}px`,
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
              onContextMenu={onContextMenu}
            />
          </EditorLayer>
          <EditorLayer type="decoration">
            <DecorationLayer />
          </EditorLayer>
          <EditorLayer type="overlay">
            <ColorIndicators />
            <Cursor />
          </EditorLayer>
        </EditorLayers>
      </div>
    );
  },
);

LineBasedEditor.displayName = "LineBasedEditor";
