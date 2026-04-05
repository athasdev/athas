import { memo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { DiffEditorLineKind } from "../../utils/diff-editor-content";

interface DiffLineBackgroundLayerProps {
  lineKinds: DiffEditorLineKind[];
  lineHeight: number;
}

const backgroundClassByKind: Record<DiffEditorLineKind, string> = {
  context: "",
  spacer: "",
  added: "bg-git-added/18",
  removed: "bg-git-deleted/18",
};

function DiffLineBackgroundLayerComponent({ lineKinds, lineHeight }: DiffLineBackgroundLayerProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]">
      {lineKinds.map((lineKind, index) => {
        const className = backgroundClassByKind[lineKind];
        if (!className) return null;

        return (
          <div
            key={`${lineKind}-${index}`}
            className={`absolute left-0 right-0 ${className}`}
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
