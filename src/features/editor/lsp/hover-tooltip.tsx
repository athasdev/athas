import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { parseMarkdown } from "@/features/editor/markdown/parser";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { highlightCodeBlock } from "./hover-tooltip-highlight";
import "./hover-tooltip.css";

export const HoverTooltip = memo(() => {
  const fontSize = useEditorSettingsStore((state) => state.fontSize);
  const { hoverInfo, actions } = useEditorUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  const handleMouseEnter = () => actions.setIsHovering(true);
  const handleMouseLeave = () => {
    actions.setIsHovering(false);
    actions.setHoverInfo(null);
  };

  useEffect(() => {
    const clearHover = () => {
      actions.setIsHovering(false);
      actions.setHoverInfo(null);
    };

    const isInsideTooltip = (target: EventTarget | null) =>
      !!containerRef.current?.contains(target as Node);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearHover();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (isInsideTooltip(event.target)) return;
      clearHover();
    };

    const onWheel = (e: WheelEvent) => {
      if (isInsideTooltip(e.target)) return;
      clearHover();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [actions]);

  const renderedContent = useMemo(() => {
    if (!hoverInfo?.content) return null;
    return parseMarkdown(hoverInfo.content);
  }, [hoverInfo?.content]);

  // Apply syntax highlighting to code blocks after initial render
  const applyHighlighting = useCallback(async (html: string) => {
    const highlighted = await highlightCodeBlock(html);
    setHighlightedHtml(highlighted);
  }, []);

  useEffect(() => {
    if (renderedContent) {
      setHighlightedHtml(null);
      applyHighlighting(renderedContent);
    }
  }, [renderedContent, applyHighlighting]);

  if (!hoverInfo) return null;

  const displayHtml = highlightedHtml ?? renderedContent;
  const maxHeight = EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT;

  // When opening upward, use bottom anchor so the card grows upward from the line
  const positionStyle = hoverInfo.opensUpward
    ? {
        left: hoverInfo.position?.left || 0,
        bottom: window.innerHeight - (hoverInfo.position?.top || 0),
      }
    : {
        left: hoverInfo.position?.left || 0,
        top: hoverInfo.position?.top || 0,
      };

  return (
    <div
      ref={containerRef}
      className="editor-overlay-card fixed w-full max-w-[440px] overflow-hidden"
      style={{
        ...positionStyle,
        fontSize: `${fontSize * 0.84}px`,
        zIndex: EDITOR_CONSTANTS.Z_INDEX.TOOLTIP,
        maxHeight,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {displayHtml && (
        <div className="hover-tooltip-body custom-scrollbar" style={{ maxHeight: maxHeight - 4 }}>
          <div
            className="markdown-preview hover-tooltip-content text-sm text-text"
            dangerouslySetInnerHTML={{ __html: displayHtml }}
          />
        </div>
      )}
    </div>
  );
});

HoverTooltip.displayName = "HoverTooltip";
