import { memo } from "react";
import { useEditorCompletionStore } from "@/features/editor/completion/completion-store";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";

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
