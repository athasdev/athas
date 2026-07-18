import { memo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { getDiffLineVisualState } from "../../utils/diff-viewer-visuals";
import type { DiffEditorLineKind } from "../../utils/diff-editor-content";

interface DiffLineBackgroundLayerProps {
  lineKinds: DiffEditorLineKind[];
  lineHeight: number;
}

function DiffLineBackgroundLayerComponent({ lineKinds, lineHeight }: DiffLineBackgroundLayerProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]">
      {lineKinds.map((lineKind, index) => {
        if (lineKind === "context" || lineKind === "spacer") return null;

        const visualState = getDiffLineVisualState(lineKind);

        return (
          <div
            key={`${lineKind}-${index}`}
            className={`absolute inset-x-0 ${visualState.lineBackground} ${visualState.railClassName}`}
            style={{
              top: `${EDITOR_CONSTANTS.EDITOR_PADDING_TOP + index * lineHeight}px`,
              height: `${lineHeight}px`,
            }}
          />
        );
      })}
    </div>
  );
}

export default memo(DiffLineBackgroundLayerComponent);
