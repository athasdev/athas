import { type RefObject, useLayoutEffect, useRef } from "react";
import { useEditorStateStore } from "../stores/state-store";
import { useEditorUIStore } from "../stores/ui-store";

interface UseBufferSwitchOptions {
  enabled?: boolean;
  bufferId: string | null;
  viewStateKey: string | null;
  content: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  forceUpdateViewport: (scrollTop: number, totalLines: number) => void;
  totalLines: number;
  resetTokenizer: () => void;
}

export function useBufferSwitch({
  enabled = true,
  bufferId,
  viewStateKey,
  content,
  textareaRef,
  forceUpdateViewport,
  totalLines,
  resetTokenizer,
}: UseBufferSwitchOptions) {
  const prevBufferIdRef = useRef<string | null>(null);
  const switchGuardRef = useRef(0);

  useLayoutEffect(() => {
    if (!enabled) return;
    if (!bufferId) return;

    const isSwitch = prevBufferIdRef.current !== null && prevBufferIdRef.current !== bufferId;
    prevBufferIdRef.current = bufferId;

    const stateActions = useEditorStateStore.getState().actions;
    const uiActions = useEditorUIStore.getState().actions;
    const viewKey = viewStateKey ?? bufferId;
    const hasRestoredInitialState = !!stateActions.getCachedViewState(viewKey);
    if (!isSwitch && !hasRestoredInitialState) return;

    // Increment guard — stale RAF callbacks will check this and bail
    switchGuardRef.current += 1;

    // 1. Reset transient state
    stateActions.resetOnBufferSwitch();
    uiActions.resetOnBufferSwitch();

    // 2. Sync textarea content before restoring position
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.value = content;
    }

    // 3. Restore cursor & scroll from cache (no DOM side-effects in store)
    const restored = stateActions.restorePositionForFile(viewKey);

    // 4. Apply scroll to DOM synchronously (before paint)
    if (textarea) {
      textarea.scrollTop = restored.scrollTop;
      textarea.scrollLeft = restored.scrollLeft;

      // Set cursor position in textarea
      const selectionStart = restored.selection?.start.offset ?? restored.cursor.offset;
      const selectionEnd = restored.selection?.end.offset ?? selectionStart;
      textarea.selectionStart = Math.min(selectionStart, textarea.value.length);
      textarea.selectionEnd = Math.min(selectionEnd, textarea.value.length);
      textarea.focus({ preventScroll: true });
    }

    // 5. Recalculate viewport range
    forceUpdateViewport(restored.scrollTop, totalLines);

    // 6. Reset token state. Tokenization is triggered by the editor effect
    // once viewport state is ready, avoiding duplicate work on buffer open.
    resetTokenizer();
  }, [
    enabled,
    bufferId,
    viewStateKey,
    content,
    textareaRef,
    forceUpdateViewport,
    totalLines,
    resetTokenizer,
  ]);

  return { switchGuardRef };
}
