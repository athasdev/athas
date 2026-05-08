/**
 * DOM-based implementation of VimEditorFacade
 *
 * This is the ONLY file in the vim feature allowed to query
 * `.editor-textarea` and `.editor-viewport`.
 */

import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { syncLastBufferContent } from "@/features/editor/stores/editor-app-store";
import { useHistoryStore } from "@/features/editor/stores/history-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { getLineHeight } from "@/features/editor/utils/position";
import type { Position } from "@/features/editor/types/editor";
import type { VimEditorFacade, ViewportMetrics } from "./editor-facade";

const getTextarea = (): HTMLTextAreaElement | null => {
  if (typeof document === "undefined") return null;
  return document.querySelector(".editor-textarea") as HTMLTextAreaElement | null;
};

const getViewport = (): HTMLDivElement | null => {
  if (typeof document === "undefined") return null;
  return document.querySelector(".editor-viewport") as HTMLDivElement | null;
};

export const createDomEditorFacade = (): VimEditorFacade => {
  return {
    getContent(): string {
      return useEditorViewStore.getState().actions.getContent();
    },

    setContent(value: string, markDirty?: boolean): void {
      const { activeBufferId, actions } = useBufferStore.getState();
      if (!activeBufferId) return;

      actions.updateBufferContent(activeBufferId, value, markDirty);
      syncLastBufferContent(activeBufferId, value);

      const textarea = getTextarea();
      if (textarea) {
        textarea.value = value;
      }
    },

    getLines(): string[] {
      return useEditorViewStore.getState().lines;
    },

    getCursorPosition(): Position {
      return useEditorStateStore.getState().cursorPosition;
    },

    setCursorPosition(position: Position): void {
      useEditorStateStore.getState().actions.setCursorPosition(position);
    },

    setSelection(start: number, end: number): void {
      const textarea = getTextarea();
      if (!textarea) return;
      textarea.selectionStart = start;
      textarea.selectionEnd = end;
      textarea.dispatchEvent(new Event("select"));
    },

    collapseSelection(offset: number): void {
      const textarea = getTextarea();
      if (!textarea) return;
      textarea.selectionStart = offset;
      textarea.selectionEnd = offset;
      textarea.dispatchEvent(new Event("select"));
    },

    focus(): void {
      const textarea = getTextarea();
      if (textarea && document.activeElement !== textarea) {
        textarea.focus();
      }
    },

    blur(): void {
      const textarea = getTextarea();
      if (textarea && document.activeElement === textarea) {
        textarea.blur();
      }
    },

    getViewportMetrics(): ViewportMetrics {
      const lines = useEditorViewStore.getState().lines;
      const totalLines = Math.max(lines.length, 1);

      const fontSize = useEditorSettingsStore.getState().fontSize;
      const defaultLineHeight = getLineHeight(fontSize);

      let lineHeight = defaultLineHeight;
      const textarea = getTextarea();
      if (textarea && typeof window !== "undefined") {
        const computedStyle = window.getComputedStyle(textarea);
        const parsedLineHeight = parseFloat(computedStyle.lineHeight);
        if (!Number.isNaN(parsedLineHeight) && parsedLineHeight > 0) {
          lineHeight = parsedLineHeight;
        } else {
          const parsedFontSize = parseFloat(computedStyle.fontSize);
          if (!Number.isNaN(parsedFontSize) && parsedFontSize > 0) {
            lineHeight = getLineHeight(parsedFontSize);
          }
        }
      }

      let scrollTop = 0;
      let viewportHeight = lineHeight * totalLines;

      const viewport = getViewport();
      if (viewport) {
        scrollTop = viewport.scrollTop;
        viewportHeight = viewport.clientHeight || viewportHeight;
      }

      const layoutState = useEditorStateStore.getState();
      if (scrollTop === 0 && layoutState.scrollTop) {
        scrollTop = layoutState.scrollTop;
      }
      if ((!viewportHeight || viewportHeight <= 0) && layoutState.viewportHeight) {
        viewportHeight = layoutState.viewportHeight;
      }
      if (!viewportHeight || viewportHeight <= 0) {
        viewportHeight = lineHeight * totalLines;
      }

      const topLine = Math.max(0, Math.min(totalLines - 1, Math.floor(scrollTop / lineHeight)));
      const bottomLine = Math.max(
        topLine,
        Math.min(totalLines - 1, Math.floor((scrollTop + viewportHeight - 1) / lineHeight)),
      );
      const visibleLines = Math.max(1, Math.floor(viewportHeight / lineHeight) || 1);

      return { topLine, bottomLine, visibleLines };
    },

    saveUndoState(): void {
      const { activeBufferId } = useBufferStore.getState();
      if (!activeBufferId) return;

      const content = useEditorViewStore.getState().actions.getContent();
      const cursorPosition = useEditorStateStore.getState().cursorPosition;

      useHistoryStore.getState().actions.pushHistory(activeBufferId, {
        content,
        cursorPosition,
        timestamp: Date.now(),
      });
    },

    setReadOnly(readonly: boolean): void {
      const textarea = getTextarea();
      if (!textarea) return;
      if (readonly) {
        textarea.readOnly = true;
      } else {
        textarea.readOnly = false;
        textarea.removeAttribute("readonly");
      }
    },

    setDataVimMode(mode: string | null): void {
      const textarea = getTextarea();
      if (!textarea) return;
      if (mode) {
        textarea.setAttribute("data-vim-mode", mode);
      } else {
        textarea.removeAttribute("data-vim-mode");
      }
    },

    setCaretColor(color: string): void {
      const textarea = getTextarea();
      if (!textarea) return;
      textarea.style.caretColor = color;
    },

    getActiveElement(): Element | null {
      return document.activeElement;
    },

    isFocused(): boolean {
      const textarea = getTextarea();
      if (!textarea) return false;
      return document.activeElement === textarea;
    },
  };
};
