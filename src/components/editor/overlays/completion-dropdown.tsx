import { memo, useEffect, useState } from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { editorAPI } from "@/extensions/editor-api";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useEditorCompletionStore } from "@/stores/editor-completion-store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { cn } from "@/utils/cn";
import { getAccurateCursorX } from "@/utils/editor-position";
import { highlightMatches } from "@/utils/fuzzy-matcher";
import { useOverlayManager } from "./overlay-manager";

interface CompletionDropdownProps {
  onApplyCompletion?: (completion: CompletionItem) => void;
}

export const CompletionDropdown = memo(({ onApplyCompletion }: CompletionDropdownProps) => {
  const isLspCompletionVisible = useEditorCompletionStore.use.isLspCompletionVisible();
  const filteredCompletions = useEditorCompletionStore.use.filteredCompletions();
  const selectedLspIndex = useEditorCompletionStore.use.selectedLspIndex();
  const currentPrefix = useEditorCompletionStore.use.currentPrefix();
  const { setIsLspCompletionVisible } = useEditorCompletionStore.use.actions();

  const cursorPosition = useEditorCursorStore.use.cursorPosition();
  const { lineHeight, gutterWidth } = useEditorLayout();
  const fontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const tabSize = useEditorSettingsStore.use.tabSize();
  const lines = useEditorViewStore.use.lines();

  const { showOverlay, hideOverlay, shouldShowOverlay } = useOverlayManager();

  // Track viewport scroll position
  const [scrollOffset, setScrollOffset] = useState({ top: 0, left: 0 });

  // Listen to viewport scroll events
  useEffect(() => {
    let viewport: HTMLElement | null = null;
    let rafId: number | null = null;

    const setupScrollListener = () => {
      viewport = editorAPI.getViewportRef();

      if (!viewport) {
        rafId = requestAnimationFrame(setupScrollListener);
        return;
      }

      const handleScroll = () => {
        if (!viewport) return;
        setScrollOffset({
          top: viewport.scrollTop,
          left: viewport.scrollLeft,
        });
      };

      handleScroll();
      viewport.addEventListener("scroll", handleScroll);

      return () => {
        if (viewport) {
          viewport.removeEventListener("scroll", handleScroll);
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

  // Check if this overlay should be shown (not hidden by higher priority overlays)
  const shouldShow = shouldShowOverlay("completion");

  if (!isLspCompletionVisible || !shouldShow) return null;

  // Get the line content for accurate positioning
  const lineContent = lines[cursorPosition.line] || "";
  const accurateX = getAccurateCursorX(
    lineContent,
    cursorPosition.column,
    fontSize,
    fontFamily,
    tabSize,
  );

  // Calculate position same as cursor but offset below the current line
  const x = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + accurateX - scrollOffset.left;
  const y = (cursorPosition.line + 1) * lineHeight - scrollOffset.top; // +1 to appear below current line

  const handleSelect = (item: CompletionItem) => {
    if (onApplyCompletion) {
      onApplyCompletion(item);
    }
    setIsLspCompletionVisible(false);
  };

  return (
    <div
      className="absolute rounded-md border border-border bg-secondary-bg shadow-lg"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        zIndex: EDITOR_CONSTANTS.Z_INDEX.COMPLETION,
        minWidth: `${EDITOR_CONSTANTS.DROPDOWN_MIN_WIDTH}px`,
        maxWidth: `${EDITOR_CONSTANTS.DROPDOWN_MAX_WIDTH}px`,
      }}
    >
      <div className="max-h-[300px] overflow-y-auto py-1">
        {filteredCompletions.map((filtered, index: number) => {
          const item = filtered.item;
          const isSelected = index === selectedLspIndex;

          return (
            <div
              key={index}
              className={cn(
                "cursor-pointer px-3 py-1.5 font-mono text-xs",
                isSelected ? "bg-blue-500 text-white" : "text-text hover:bg-hover",
              )}
              onClick={() => handleSelect(item)}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {currentPrefix && filtered.indices.length > 0
                    ? highlightMatches(item.label, filtered.indices)
                    : item.label}
                </span>
                {item.detail && (
                  <span className={isSelected ? "text-blue-100" : "text-text-lighter"}>
                    {item.detail}
                  </span>
                )}
              </div>
              {item.documentation && (
                <div
                  className={cn(
                    "mt-0.5 text-xs",
                    isSelected ? "text-blue-100" : "text-text-lighter",
                  )}
                >
                  {typeof item.documentation === "string"
                    ? item.documentation
                    : item.documentation.value}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

CompletionDropdown.displayName = "CompletionDropdown";
