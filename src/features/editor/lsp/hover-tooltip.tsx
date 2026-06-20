import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useHighlightedMarkdown } from "@/features/editor/markdown/use-highlighted-markdown";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { useEditorUIStore } from "@/features/editor/stores/ui.store";
import "../markdown/styles.css";
import "../styles/overlay-card.css";
import "./hover-tooltip.css";

export const HoverTooltip = memo(() => {
  const fontSize = useEditorSettingsStore((state) => state.fontSize);
  const lineHeight = useEditorSettingsStore((state) => state.lineHeight);
  const fontFamily = useEditorSettingsStore((state) => state.fontFamily);
  const { hoverInfo, actions } = useEditorUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [resolvedPosition, setResolvedPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const displayHtml = useHighlightedMarkdown(hoverInfo?.content);

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

  useLayoutEffect(() => {
    if (!hoverInfo || !containerRef.current) {
      setResolvedPosition(null);
      return;
    }

    const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
    const rect = containerRef.current.getBoundingClientRect();
    const bounds = hoverInfo.bounds ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
    };

    let left = hoverInfo.position.left;
    let top = hoverInfo.opensUpward ? hoverInfo.position.top - rect.height : hoverInfo.position.top;

    if (left + rect.width > bounds.right - margin) {
      left = bounds.right - rect.width - margin;
    }
    if (left < bounds.left + margin) {
      left = bounds.left + margin;
    }

    if (top + rect.height > bounds.bottom - margin) {
      top = bounds.bottom - rect.height - margin;
    }
    if (top < bounds.top + margin) {
      top = bounds.top + margin;
    }

    setResolvedPosition((current) => {
      if (current && current.top === top && current.left === left) {
        return current;
      }
      return { top, left };
    });
  }, [hoverInfo, displayHtml]);

  if (!hoverInfo) return null;

  const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
  const bounds = hoverInfo.bounds ?? {
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    left: 0,
  };
  const boundedWidth = Math.max(0, bounds.right - bounds.left - margin * 2);
  const maxWidth = Math.min(EDITOR_CONSTANTS.DROPDOWN_MAX_WIDTH, boundedWidth);
  const availableHeight = hoverInfo.opensUpward
    ? Math.max(0, hoverInfo.position.top - bounds.top - margin)
    : Math.max(0, bounds.bottom - hoverInfo.position.top - margin);
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
        lineHeight: `${Math.ceil(fontSize * lineHeight)}px`,
        ["--hover-tooltip-font-size" as string]: `${fontSize}px`,
        ["--hover-tooltip-line-height" as string]: `${Math.ceil(fontSize * lineHeight)}px`,
        zIndex: EDITOR_CONSTANTS.Z_INDEX.TOOLTIP,
        width: "max-content",
        maxWidth,
        maxHeight,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {displayHtml && (
        <div
          className="hover-tooltip-body custom-scrollbar"
          style={{ maxHeight: Math.max(0, maxHeight - 4) }}
        >
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
