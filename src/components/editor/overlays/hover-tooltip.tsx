import { memo } from "react";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { useEditorCompletionStore } from "@/stores/editor-completion-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";

export const HoverTooltip = memo(() => {
  const fontSize = useEditorSettingsStore((state) => state.fontSize);
  const fontFamily = useEditorSettingsStore((state) => state.fontFamily);
  const { hoverInfo, actions } = useEditorCompletionStore();

  const handleMouseEnter = () => actions.setIsHovering(true);
  const handleMouseLeave = () => actions.setIsHovering(false);

  if (!hoverInfo) return null;

  return (
    <div
      className="fixed max-w-md rounded border border-border bg-primary-bg p-3 shadow-lg"
      style={{
        left: hoverInfo.position?.left || 0,
        top: hoverInfo.position?.top || 0,
        fontSize: `${fontSize * 0.9}px`,
        fontFamily: fontFamily,
        zIndex: EDITOR_CONSTANTS.Z_INDEX.TOOLTIP,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {hoverInfo.content && <div className="text-sm text-text">{hoverInfo.content}</div>}
    </div>
  );
});

HoverTooltip.displayName = "HoverTooltip";
