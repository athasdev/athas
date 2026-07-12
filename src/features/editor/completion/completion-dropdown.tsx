import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { memo, useEffect, useMemo, useState } from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { editorAPI } from "@/features/editor/extensions/api";
import { useEditorLayout } from "@/features/editor/hooks/use-layout";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useEditorUIStore } from "@/features/editor/stores/ui.store";
import { useEditorViewStore } from "@/features/editor/stores/view.store";
import { getAccurateCursorX } from "@/features/editor/utils/position";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { instantTransition, motionDuration, motionEase } from "@/ui/motion";
import { cn } from "@/utils/cn";
import { highlightMatches } from "@/utils/fuzzy-matcher";
import { useOverlayManager } from "../hooks/use-overlay-manager";
import "./completion-dropdown.css";

interface CompletionDropdownProps {
  onApplyCompletion?: (completion: CompletionItem) => void;
}

function CompletionDropdownContent({ onApplyCompletion }: CompletionDropdownProps) {
  const filteredCompletions = useEditorUIStore.use.filteredCompletions();
  const selectedLspIndex = useEditorUIStore.use.selectedLspIndex();
  const currentPrefix = useEditorUIStore.use.currentPrefix();
  const { setIsLspCompletionVisible } = useEditorUIStore.use.actions();

  const cursorPosition = useEditorStateStore.use.cursorPosition();
  const { gutterWidth } = useEditorLayout();
  const baseFontSize = useEditorSettingsStore.use.fontSize();
  const lineHeightMultiplier = useEditorSettingsStore.use.lineHeight();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const tabSize = useEditorSettingsStore.use.tabSize();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const lineContent = useEditorViewStore((state) => state.lines[cursorPosition.line] ?? "");
  const prefersReducedMotion = useReducedMotion();

  const fontSize = baseFontSize * zoomLevel;
  const lineHeight = Math.ceil(fontSize * lineHeightMultiplier);
  const [scrollOffset, setScrollOffset] = useState({ top: 0, left: 0 });

  useEffect(() => {
    let textarea: HTMLTextAreaElement | null = null;
    let rafId: number | null = null;

    const setupScrollListener = () => {
      textarea = editorAPI.getTextareaRef();

      if (!textarea) {
        rafId = requestAnimationFrame(setupScrollListener);
        return undefined;
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

  const { x, y } = useMemo(() => {
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
    lineContent,
    fontSize,
    fontFamily,
    tabSize,
    gutterWidth,
    lineHeight,
    scrollOffset.left,
    scrollOffset.top,
  ]);

  const handleSelect = (item: CompletionItem) => {
    if (onApplyCompletion) {
      onApplyCompletion(item);
    }
    setIsLspCompletionVisible(false);
  };

  const visibleCompletions = filteredCompletions;
  const selectedItem = visibleCompletions[selectedLspIndex]?.item;
  const selectedDocumentation = selectedItem?.documentation
    ? typeof selectedItem.documentation === "string"
      ? selectedItem.documentation
      : selectedItem.documentation.value
    : null;
  const selectedDetail = selectedItem?.detail;
  const hasDocPanel = selectedDocumentation || selectedDetail;

  return (
    <motion.div
      initial={
        prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: -4, filter: "blur(2px)" }
      }
      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
      exit={
        prefersReducedMotion
          ? { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }
          : { opacity: 0, scale: 0.98, y: -4, filter: "blur(2px)" }
      }
      transition={
        prefersReducedMotion
          ? instantTransition
          : { duration: motionDuration.fast, ease: motionEase.smooth }
      }
      className="editor-completion-dropdown absolute flex items-start"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        zIndex: EDITOR_CONSTANTS.Z_INDEX.COMPLETION,
        transformOrigin: "top left",
      }}
    >
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
                "editor-completion-item font-sans cursor-pointer px-2 py-1 ui-text-sm",
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
            <div className="font-sans mb-1 font-medium text-text ui-text-sm">{selectedDetail}</div>
          )}
          {selectedDocumentation && (
            <div className="font-sans whitespace-pre-wrap text-text-lighter ui-text-sm">
              {selectedDocumentation}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

export const CompletionDropdown = memo(
  ({ onApplyCompletion }: CompletionDropdownProps) => {
    const isLspCompletionVisible = useEditorUIStore.use.isLspCompletionVisible();
    const { showOverlay, hideOverlay } = useOverlayManager();

    useEffect(() => {
      if (isLspCompletionVisible) {
        showOverlay("completion");
      } else {
        hideOverlay("completion");
      }
    }, [isLspCompletionVisible, showOverlay, hideOverlay]);

    return (
      <AnimatePresence>
        {isLspCompletionVisible && (
          <CompletionDropdownContent onApplyCompletion={onApplyCompletion} />
        )}
      </AnimatePresence>
    );
  },
  (prevProps, nextProps) => prevProps.onApplyCompletion === nextProps.onApplyCompletion,
);

CompletionDropdown.displayName = "CompletionDropdown";
