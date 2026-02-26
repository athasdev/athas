import { memo, useEffect, useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { parseMarkdown } from "@/features/editor/markdown/parser";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import "./hover-tooltip.css";

export const HoverTooltip = memo(() => {
  const fontSize = useEditorSettingsStore((state) => state.fontSize);
  const { hoverInfo, actions } = useEditorUIStore();

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

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearHover();
      }
    };

    const onGlobalInteraction = () => {
      clearHover();
    };

    window.addEventListener("blur", clearHover);
    window.addEventListener("keydown", onGlobalInteraction, true);
    window.addEventListener("pointerdown", onGlobalInteraction, true);
    window.addEventListener("wheel", onGlobalInteraction, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", clearHover);
      window.removeEventListener("keydown", onGlobalInteraction, true);
      window.removeEventListener("pointerdown", onGlobalInteraction, true);
      window.removeEventListener("wheel", onGlobalInteraction, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [actions]);

  const renderedContent = useMemo(() => {
    if (!hoverInfo?.content) return null;
    return parseMarkdown(hoverInfo.content);
  }, [hoverInfo?.content]);

  if (!hoverInfo) return null;

  const bodyMaxHeight = Math.max(110, EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT - 16);

  return (
    <div
      className="hover-tooltip fixed w-full max-w-[440px] overflow-hidden"
      style={{
        left: hoverInfo.position?.left || 0,
        top: hoverInfo.position?.top || 0,
        fontSize: `${fontSize * 0.84}px`,
        zIndex: EDITOR_CONSTANTS.Z_INDEX.TOOLTIP,
        maxHeight: EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {renderedContent && (
        <div className="hover-tooltip-body custom-scrollbar" style={{ maxHeight: bodyMaxHeight }}>
          <div
            className="markdown-preview hover-tooltip-content text-sm text-text"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        </div>
      )}
    </div>
  );
});

HoverTooltip.displayName = "HoverTooltip";
