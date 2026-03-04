import { type RefObject, useLayoutEffect, useRef } from "react";
import { useEditorStateStore } from "../stores/state-store";
import { useEditorUIStore } from "../stores/ui-store";
import type { ViewportRange } from "./use-viewport-lines";

interface UseBufferSwitchOptions {
  bufferId: string | null;
  content: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  forceUpdateViewport: (scrollTop: number, totalLines: number) => void;
  totalLines: number;
  resetTokenizer: () => void;
  tokenize: (text: string, viewportRange?: ViewportRange) => Promise<void>;
}

export function useBufferSwitch({
  bufferId,
  content,
  textareaRef,
  forceUpdateViewport,
  totalLines,
  resetTokenizer,
  tokenize,
}: UseBufferSwitchOptions) {
  const prevBufferIdRef = useRef<string | null>(null);
  const switchGuardRef = useRef(0);

  useLayoutEffect(() => {
    if (!bufferId) return;

    const isSwitch = prevBufferIdRef.current !== null && prevBufferIdRef.current !== bufferId;
    prevBufferIdRef.current = bufferId;

    if (!isSwitch) return;

    // Increment guard — stale RAF callbacks will check this and bail
    switchGuardRef.current += 1;

    const stateActions = useEditorStateStore.getState().actions;
    const uiActions = useEditorUIStore.getState().actions;

    // 1. Reset transient state
    stateActions.resetOnBufferSwitch();
    uiActions.resetOnBufferSwitch();

    // 2. Sync textarea content before restoring position
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.value = content;
    }

    // 3. Restore cursor & scroll from cache (no DOM side-effects in store)
    const restored = stateActions.restorePositionForFile(bufferId);

    // 4. Apply scroll to DOM synchronously (before paint)
    if (textarea) {
      textarea.scrollTop = restored.scrollTop;
      textarea.scrollLeft = restored.scrollLeft;

      // Set cursor position in textarea
      const safeOffset = Math.min(restored.cursor.offset, textarea.value.length);
      textarea.selectionStart = safeOffset;
      textarea.selectionEnd = safeOffset;
      textarea.focus({ preventScroll: true });
    }

    // 5. Recalculate viewport range
    forceUpdateViewport(restored.scrollTop, totalLines);

    // 6. Reset and re-trigger tokenization
    resetTokenizer();
    void tokenize(content);
  }, [bufferId, content, textareaRef, forceUpdateViewport, totalLines, resetTokenizer, tokenize]);

  return { switchGuardRef };
}
