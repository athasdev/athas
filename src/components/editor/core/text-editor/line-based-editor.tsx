import { memo, useEffect, useRef } from "react";
import { editorAPI } from "@/extensions/editor-api";
import { useEditorInteractions } from "@/hooks/use-editor-interactions";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useEditorLayoutStore } from "@/stores/editor-layout-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import type { Position } from "@/types/editor-types";
import { Cursor } from "../../overlays/cursor";
import { DecorationLayer } from "../../overlays/decoration-layer";
import { EditorViewport } from "../../rendering/editor-viewport";
import { EditorLayer, EditorLayers } from "./editor-layers";
import "@/styles/editor-line-based.css";
import "@/styles/token-theme.css";

interface LineBasedEditorProps {
  onPositionClick?: (position: Position) => void;
  onSelectionDrag?: (start: Position, end: Position) => void;
  viewportRef?: React.MutableRefObject<HTMLDivElement | null>;
  onContextMenu?: (e: React.MouseEvent) => void;
  onGitIndicatorClick?: (lineNumber: number, changeType: string) => void;
}

export const LineBasedEditor = memo<LineBasedEditorProps>(
  ({ onPositionClick, onSelectionDrag, viewportRef, onContextMenu, onGitIndicatorClick }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const internalViewportRef = useRef<HTMLDivElement>(null);

    const fontSize = useEditorSettingsStore.use.fontSize();
    const { viewportHeight } = useEditorLayoutStore();
    const { lineHeight, gutterWidth } = useEditorLayout();

    const { handleClick, handleMouseDown, handleMouseMove, handleMouseUp } = useEditorInteractions({
      lineHeight,
      fontSize,
      gutterWidth,
      onPositionClick,
      onSelectionDrag,
    });

    // Scroll is now tracked locally in viewport - no need to update store on every scroll event
    // This prevents unnecessary re-renders and improves scroll performance
    const handleScroll = () => {
      // Store updates removed - scroll position is tracked locally in viewport
    };

    // Store viewport ref for parent access and update editorAPI
    useEffect(() => {
      if (viewportRef && internalViewportRef.current) {
        viewportRef.current = internalViewportRef.current;
        // Update editorAPI with the viewport ref so overlays can access it
        editorAPI.setViewportRef(internalViewportRef.current);
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
              onGitIndicatorClick={onGitIndicatorClick}
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
