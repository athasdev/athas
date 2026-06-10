import { type RefObject, useLayoutEffect, useRef } from "react";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useEditorUIStore } from "@/features/editor/stores/ui.store";
import { shouldRestoreBufferSwitchState } from "@/features/athas-editor/utils/buffer-switch-state";

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
  const prevViewKeyRef = useRef<string | null>(null);
  const hasInitializedRef = useRef(false);
  const latestContentRef = useRef(content);
  const latestTotalLinesRef = useRef(totalLines);
  const switchGuardRef = useRef(0);

  useLayoutEffect(() => {
    latestContentRef.current = content;
    latestTotalLinesRef.current = totalLines;
  }, [content, totalLines]);

  useLayoutEffect(() => {
    if (!enabled) return;
    if (!bufferId) return;

    const viewKey = viewStateKey ?? bufferId;
    const hasRestoredInitialState = !!useEditorStateStore
      .getState()
      .actions.getCachedViewState(viewKey);
    const shouldRestoreState = shouldRestoreBufferSwitchState({
      hasInitialized: hasInitializedRef.current,
      previousBufferId: prevBufferIdRef.current,
      previousViewKey: prevViewKeyRef.current,
      nextBufferId: bufferId,
      nextViewKey: viewKey,
      hasCachedViewState: hasRestoredInitialState,
    });

    prevBufferIdRef.current = bufferId;
    prevViewKeyRef.current = viewKey;
    hasInitializedRef.current = true;

    const stateActions = useEditorStateStore.getState().actions;
    const uiActions = useEditorUIStore.getState().actions;
    if (!shouldRestoreState) return;

    // Increment guard — stale RAF callbacks will check this and bail
    switchGuardRef.current += 1;

    // 1. Reset transient state
    stateActions.resetOnBufferSwitch();
    uiActions.resetOnBufferSwitch();

    // 2. Sync textarea content before restoring position
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.value = latestContentRef.current;
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
    forceUpdateViewport(restored.scrollTop, latestTotalLinesRef.current);

    // 6. Reset token state. Tokenization is triggered by the editor effect
    // once viewport state is ready, avoiding duplicate work on buffer open.
    resetTokenizer();
  }, [enabled, bufferId, viewStateKey, textareaRef, forceUpdateViewport, resetTokenizer]);

  return { switchGuardRef };
}
