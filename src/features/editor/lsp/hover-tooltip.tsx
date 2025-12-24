import { memo, useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { parseMarkdown } from "@/features/editor/markdown/parser";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";

export const HoverTooltip = memo(() => {
  const fontSize = useEditorSettingsStore((state) => state.fontSize);
  const fontFamily = useEditorSettingsStore((state) => state.fontFamily);
  const { hoverInfo, actions } = useEditorUIStore();

  const handleMouseEnter = () => actions.setIsHovering(true);
  const handleMouseLeave = () => actions.setIsHovering(false);

  const renderedContent = useMemo(() => {
    if (!hoverInfo?.content) return null;
    return parseMarkdown(hoverInfo.content);
  }, [hoverInfo?.content]);

  if (!hoverInfo) return null;

  return (
    <div
      className="hover-tooltip fixed max-w-lg overflow-auto rounded border border-border bg-primary-bg p-3 shadow-lg"
      style={{
        left: hoverInfo.position?.left || 0,
        top: hoverInfo.position?.top || 0,
        fontSize: `${fontSize * 0.9}px`,
        fontFamily: fontFamily,
        zIndex: EDITOR_CONSTANTS.Z_INDEX.TOOLTIP,
        maxHeight: EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {renderedContent && (
        <div
          className="markdown-preview hover-tooltip-content text-sm text-text"
          dangerouslySetInnerHTML={{ __html: renderedContent }}
        />
      )}
    </div>
  );
});

HoverTooltip.displayName = "HoverTooltip";
