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
import { cn } from "@/utils/cn";
import { highlightMatches } from "@/utils/fuzzy-matcher";
import { useOverlayManager } from "../hooks/use-overlay-manager";

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

    return (
      <div
        className="absolute border border-border bg-secondary-bg shadow-md"
        style={{
          left: `${x}px`,
          top: `${y}px`,
          zIndex: EDITOR_CONSTANTS.Z_INDEX.COMPLETION,
          minWidth: `${EDITOR_CONSTANTS.DROPDOWN_MIN_WIDTH}px`,
          maxWidth: `${EDITOR_CONSTANTS.DROPDOWN_MAX_WIDTH}px`,
        }}
      >
        <div className="custom-scrollbar-thin max-h-[200px] overflow-y-auto">
          {filteredCompletions.map((filtered, index: number) => {
            const item = filtered.item;
            const isSelected = index === selectedLspIndex;

            return (
              <div
                key={index}
                className={cn(
                  "ui-font cursor-pointer px-2 py-1 text-xs",
                  isSelected ? "bg-accent text-primary-bg" : "text-text hover:bg-hover",
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
                    <span className={isSelected ? "opacity-80" : "text-text-lighter"}>
                      {item.detail}
                    </span>
                  )}
                </div>
                {item.documentation && (
                  <div
                    className={cn(
                      "mt-0.5 text-xs",
                      isSelected ? "opacity-80" : "text-text-lighter",
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
  },
  // Only re-render if onApplyCompletion callback changes
  (prevProps, nextProps) => prevProps.onApplyCompletion === nextProps.onApplyCompletion,
);

CompletionDropdown.displayName = "CompletionDropdown";
