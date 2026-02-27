import { memo, useEffect, useMemo, useState } from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { editorAPI } from "@/features/editor/extensions/api";
import { useEditorLayout } from "@/features/editor/hooks/use-layout";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { getAccurateCursorX } from "@/features/editor/utils/position";
import { useZoomStore } from "@/stores/zoom-store";
import { cn } from "@/utils/cn";
import { highlightMatches } from "@/utils/fuzzy-matcher";
import { useOverlayManager } from "../hooks/use-overlay-manager";
import "./completion-dropdown.css";

interface CompletionDropdownProps {
  onApplyCompletion?: (completion: CompletionItem) => void;
}

export const CompletionDropdown = memo(
  ({ onApplyCompletion }: CompletionDropdownProps) => {
    const isLspCompletionVisible = useEditorUIStore.use.isLspCompletionVisible();
    const filteredCompletions = useEditorUIStore.use.filteredCompletions();
    const selectedLspIndex = useEditorUIStore.use.selectedLspIndex();
    const currentPrefix = useEditorUIStore.use.currentPrefix();
    const { setIsLspCompletionVisible } = useEditorUIStore.use.actions();

    const cursorPosition = useEditorStateStore.use.cursorPosition();
    const { gutterWidth } = useEditorLayout();
    const baseFontSize = useEditorSettingsStore.use.fontSize();
    const fontFamily = useEditorSettingsStore.use.fontFamily();
    const tabSize = useEditorSettingsStore.use.tabSize();
    const lines = useEditorViewStore.use.lines();
    const zoomLevel = useZoomStore.use.editorZoomLevel();

    // Apply zoom to match the editor's actual font size and line height
    const fontSize = baseFontSize * zoomLevel;
    const lineHeight = fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER;

    const { showOverlay, hideOverlay, shouldShowOverlay } = useOverlayManager();

    // Track viewport scroll position
    const [scrollOffset, setScrollOffset] = useState({ top: 0, left: 0 });

    // Listen to textarea scroll events
    useEffect(() => {
      let textarea: HTMLTextAreaElement | null = null;
      let rafId: number | null = null;

      const setupScrollListener = () => {
        textarea = editorAPI.getTextareaRef();

        if (!textarea) {
          rafId = requestAnimationFrame(setupScrollListener);
          return;
        }

        const handleScroll = () => {
          if (!textarea) return;
          setScrollOffset({
            top: textarea.scrollTop,
            left: textarea.scrollLeft,
          });
        };

        handleScroll();
        textarea.addEventListener("scroll", handleScroll);

        return () => {
          if (textarea) {
            textarea.removeEventListener("scroll", handleScroll);
          }
        };
      };

      const cleanup = setupScrollListener();

      return () => {
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        cleanup?.();
      };
    }, []);

    // Register/unregister with overlay manager
    useEffect(() => {
      if (isLspCompletionVisible) {
        showOverlay("completion");
      } else {
        hideOverlay("completion");
      }
    }, [isLspCompletionVisible, showOverlay, hideOverlay]);

    // Memoize dropdown position calculation (must be before early return per hooks rules)
    const { x, y } = useMemo(() => {
      const lineContent = lines[cursorPosition.line] || "";
      const accurateX = getAccurateCursorX(
        lineContent,
        cursorPosition.column,
        fontSize,
        fontFamily,
        tabSize,
      );

      return {
        x: gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + accurateX - scrollOffset.left,
        y:
          EDITOR_CONSTANTS.EDITOR_PADDING_TOP +
          (cursorPosition.line + 1) * lineHeight -
          scrollOffset.top,
      };
    }, [
      cursorPosition.line,
      cursorPosition.column,
      lines,
      fontSize,
      fontFamily,
      tabSize,
      gutterWidth,
      lineHeight,
      scrollOffset.left,
      scrollOffset.top,
    ]);

    // Check if this overlay should be shown (not hidden by higher priority overlays)
    const shouldShow = shouldShowOverlay("completion");

    if (!isLspCompletionVisible || !shouldShow) return null;

    const handleSelect = (item: CompletionItem) => {
      if (onApplyCompletion) {
        onApplyCompletion(item);
      }
      setIsLspCompletionVisible(false);
    };

    // Show all completions (container will be scrollable)
    const visibleCompletions = filteredCompletions;

    // Get selected item's documentation
    const selectedItem = visibleCompletions[selectedLspIndex]?.item;
    const selectedDocumentation = selectedItem?.documentation
      ? typeof selectedItem.documentation === "string"
        ? selectedItem.documentation
        : selectedItem.documentation.value
      : null;
    const selectedDetail = selectedItem?.detail;
    const hasDocPanel = selectedDocumentation || selectedDetail;

    return (
      <div
        className="editor-completion-dropdown absolute flex items-start"
        style={{
          left: `${x}px`,
          top: `${y}px`,
          zIndex: EDITOR_CONSTANTS.Z_INDEX.COMPLETION,
        }}
      >
        {/* Main completion list */}
        <div
          className="editor-completion-list custom-scrollbar overflow-y-auto"
          style={{
            minWidth: `${EDITOR_CONSTANTS.DROPDOWN_MIN_WIDTH}px`,
            maxWidth: `${EDITOR_CONSTANTS.DROPDOWN_MAX_WIDTH}px`,
            maxHeight: `${EDITOR_CONSTANTS.MAX_VISIBLE_COMPLETIONS * 24}px`,
          }}
        >
          {visibleCompletions.map((filtered, index: number) => {
            const item = filtered.item;
            const isSelected = index === selectedLspIndex;

            return (
              <div
                key={index}
                ref={(el) => {
                  if (isSelected && el) {
                    el.scrollIntoView({ block: "nearest" });
                  }
                }}
                className={cn(
                  "editor-completion-item ui-font cursor-pointer px-2 py-1 text-xs",
                  isSelected
                    ? "editor-completion-item-selected text-text"
                    : "text-text hover:bg-hover",
                )}
                onClick={() => handleSelect(item)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {currentPrefix && filtered.indices.length > 0
                      ? highlightMatches(item.label, filtered.indices)
                      : item.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Documentation panel (VS Code style) */}
        {hasDocPanel && (
          <div
            className="editor-completion-docs custom-scrollbar ml-1 p-2"
            style={{
              minWidth: "200px",
              maxWidth: "300px",
              maxHeight: `${EDITOR_CONSTANTS.MAX_VISIBLE_COMPLETIONS * 24 + 8}px`,
              overflow: "auto",
            }}
          >
            {selectedDetail && (
              <div className="ui-font mb-1 font-medium text-text text-xs">{selectedDetail}</div>
            )}
            {selectedDocumentation && (
              <div className="ui-font whitespace-pre-wrap text-text-lighter text-xs">
                {selectedDocumentation}
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
  // Only re-render if onApplyCompletion callback changes
  (prevProps, nextProps) => prevProps.onApplyCompletion === nextProps.onApplyCompletion,
);

CompletionDropdown.displayName = "CompletionDropdown";
