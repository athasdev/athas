import { type RefObject, useEffect } from "react";
import type { ViewPosition } from "../view-model/view-layout";
import { isDragScrolling } from "./use-drag-scroll";

interface UseEnsureCursorVisibleOptions {
  enabled: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  cursorViewPosition?: ViewPosition;
  lineHeight: number;
  bottomSafePadding: number;
}

export function useEnsureCursorVisible({
  enabled,
  inputRef,
  cursorViewPosition,
  lineHeight,
  bottomSafePadding,
}: UseEnsureCursorVisibleOptions) {
  useEffect(() => {
    if (!enabled || !cursorViewPosition || isDragScrolling()) return;

    const textarea = inputRef.current;
    if (!textarea) return;

    const targetTop = cursorViewPosition.top;
    const targetBottom = targetTop + cursorViewPosition.segment.height;
    const currentScrollTop = textarea.scrollTop;
    const viewportHeight = textarea.clientHeight || 0;
    if (viewportHeight <= 0) return;

    const safeViewportHeight = Math.max(lineHeight * 2, viewportHeight - bottomSafePadding);

    if (targetTop < currentScrollTop) {
      textarea.scrollTop = targetTop;
    } else if (targetBottom > currentScrollTop + safeViewportHeight) {
      textarea.scrollTop = Math.max(0, targetBottom - safeViewportHeight);
    }
  }, [bottomSafePadding, cursorViewPosition, enabled, inputRef, lineHeight]);
}
