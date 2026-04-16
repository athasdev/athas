import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { parseMarkdown } from "@/features/editor/markdown/parser";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { highlightCodeBlock } from "./hover-tooltip-highlight";
import "./hover-tooltip.css";

export const HoverTooltip = memo(() => {
  const fontSize = useEditorSettingsStore((state) => state.fontSize);
  const fontFamily = useEditorSettingsStore((state) => state.fontFamily);
  const { hoverInfo, actions } = useEditorUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [resolvedPosition, setResolvedPosition] = useState<{ top: number; left: number } | null>(
    null,
  );

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

  useLayoutEffect(() => {
    if (!hoverInfo || !containerRef.current) {
      setResolvedPosition(null);
      return;
    }

    const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
    const rect = containerRef.current.getBoundingClientRect();

    let left = hoverInfo.position.left;
    let top = hoverInfo.opensUpward ? hoverInfo.position.top - rect.height : hoverInfo.position.top;

    if (left + rect.width > window.innerWidth - margin) {
      left = window.innerWidth - rect.width - margin;
    }
    if (left < margin) {
      left = margin;
    }

    if (top + rect.height > window.innerHeight - margin) {
      top = window.innerHeight - rect.height - margin;
    }
    if (top < margin) {
      top = margin;
    }

    setResolvedPosition((current) => {
      if (current && current.top === top && current.left === left) {
        return current;
      }
      return { top, left };
    });
  }, [hoverInfo, highlightedHtml, renderedContent]);

  useEffect(() => {
    if (renderedContent) {
      setHighlightedHtml(null);
      applyHighlighting(renderedContent);
    }
  }, [renderedContent, applyHighlighting]);

  if (!hoverInfo) return null;

  const displayHtml = highlightedHtml ?? renderedContent;
  const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
  const maxWidth = Math.min(
    EDITOR_CONSTANTS.DROPDOWN_MAX_WIDTH,
    Math.max(220, window.innerWidth - margin * 2),
  );
  const availableHeight = hoverInfo.opensUpward
    ? Math.max(140, hoverInfo.position.top - margin)
    : Math.max(140, window.innerHeight - hoverInfo.position.top - margin);
  const maxHeight = Math.min(EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT, availableHeight);

  const positionStyle = resolvedPosition ?? {
    left: hoverInfo.position?.left || 0,
    top: hoverInfo.opensUpward
      ? Math.max(margin, hoverInfo.position.top - maxHeight)
      : hoverInfo.position?.top || 0,
  };

  return (
    <div
      ref={containerRef}
      className="editor-overlay-card fixed overflow-hidden"
      style={{
        ...positionStyle,
        fontSize: `${fontSize}px`,
        fontFamily,
        lineHeight: `${Math.ceil(fontSize * 1.45)}px`,
        ["--hover-tooltip-font-size" as string]: `${fontSize}px`,
        ["--hover-tooltip-line-height" as string]: `${Math.ceil(fontSize * 1.45)}px`,
        zIndex: EDITOR_CONSTANTS.Z_INDEX.TOOLTIP,
        width: "max-content",
        maxWidth,
        maxHeight,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {displayHtml && (
        <div className="hover-tooltip-body custom-scrollbar" style={{ maxHeight: maxHeight - 4 }}>
          <div
            className="markdown-preview hover-tooltip-content text-text"
            dangerouslySetInnerHTML={{ __html: displayHtml }}
          />
        </div>
      )}
    </div>
  );
});

HoverTooltip.displayName = "HoverTooltip";
