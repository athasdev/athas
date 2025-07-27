import { memo } from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";
import { EDITOR_CONSTANTS } from "../../../constants/editor-constants";
import { useEditorLayout } from "../../../hooks/use-editor-layout";
import { useEditorCompletionStore } from "../../../stores/editor-completion-store";
import { useEditorCursorStore } from "../../../stores/editor-cursor-store";
import { useEditorLayoutStore } from "../../../stores/editor-layout-store";

interface CompletionDropdownProps {
  onApplyCompletion?: (completion: CompletionItem) => void;
}

export const CompletionDropdown = memo(({ onApplyCompletion }: CompletionDropdownProps) => {
  const { isLspCompletionVisible, lspCompletions, selectedLspIndex, actions } =
    useEditorCompletionStore();
  const cursorPosition = useEditorCursorStore((state) => state.cursorPosition);
  const { scrollTop, scrollLeft } = useEditorLayoutStore();
  const { lineHeight, charWidth, gutterWidth } = useEditorLayout();
  const GUTTER_MARGIN = 8; // Same as cursor component

  if (!isLspCompletionVisible) return null;

  // Calculate position same as cursor but offset below the current line
  const x = gutterWidth + GUTTER_MARGIN + cursorPosition.column * charWidth - scrollLeft;
  const y = (cursorPosition.line + 1) * lineHeight - scrollTop; // +1 to appear below current line

  const handleSelect = (item: CompletionItem) => {
    if (onApplyCompletion) {
      onApplyCompletion(item);
    }
    actions.setIsLspCompletionVisible(false);
  };

  return (
    <div
      className="absolute rounded-md border border-border bg-secondary-bg shadow-lg"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        zIndex: EDITOR_CONSTANTS.Z_INDEX.DROPDOWN,
        minWidth: `${EDITOR_CONSTANTS.DROPDOWN_MIN_WIDTH}px`,
        maxWidth: `${EDITOR_CONSTANTS.DROPDOWN_MAX_WIDTH}px`,
      }}
    >
      <div className="max-h-[300px] overflow-y-auto py-1">
        {lspCompletions.map((item: any, index: number) => (
          <div
            key={index}
            className={`cursor-pointer px-3 py-1.5 font-mono text-xs ${
              index === selectedLspIndex ? "bg-blue-500 text-white" : "text-text hover:bg-hover"
            }`}
            onClick={() => handleSelect(item)}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{item.label}</span>
              {item.detail && (
                <span
                  className={index === selectedLspIndex ? "text-blue-100" : "text-text-lighter"}
                >
                  {item.detail}
                </span>
              )}
            </div>
            {item.documentation && (
              <div
                className={`mt-0.5 text-xs ${
                  index === selectedLspIndex ? "text-blue-100" : "text-text-lighter"
                }`}
              >
                {typeof item.documentation === "string"
                  ? item.documentation
                  : item.documentation.value}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

CompletionDropdown.displayName = "CompletionDropdown";
