import { useCallback } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useJumpListStore } from "@/features/editor/stores/jump-list.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { navigateToJumpEntry } from "@/features/editor/utils/jump-navigation";
import { Button } from "@/ui/button";
import { ArrowLeftIcon, ArrowRightIcon } from "@/ui/icons";

export function TitleNavigation() {
  const entries = useJumpListStore.use.entries();
  const currentIndex = useJumpListStore.use.currentIndex();
  const { goBack, goForward } = useJumpListStore.use.actions();
  const canGoBack = entries.length > 0 && (currentIndex === -1 || currentIndex > 0);
  const canGoForward = currentIndex >= 0 && currentIndex < entries.length - 1;

  const handleGoBack = useCallback(async () => {
    const bufferStore = useBufferStore.getState();
    const editorState = useEditorStateStore.getState();
    const activeBufferId = bufferStore.activeBufferId;
    const activeBuffer = getBufferById(bufferStore.buffers, activeBufferId);
    const currentPosition =
      activeBufferId && activeBuffer?.path
        ? {
            bufferId: activeBufferId,
            filePath: activeBuffer.path,
            line: editorState.cursorPosition.line,
            column: editorState.cursorPosition.column,
            offset: editorState.cursorPosition.offset,
            scrollTop: editorState.scrollTop,
            scrollLeft: editorState.scrollLeft,
          }
        : undefined;
    const entry = goBack(currentPosition);
    if (entry) await navigateToJumpEntry(entry);
  }, [goBack]);

  const handleGoForward = useCallback(async () => {
    const entry = goForward();
    if (entry) await navigateToJumpEntry(entry);
  }, [goForward]);

  return (
    <div
      data-slot="title-navigation"
      className="absolute inset-y-0 left-0 z-10 flex items-center pl-title-bar-leading"
    >
      <Button
        type="button"
        onClick={() => void handleGoBack()}
        disabled={!canGoBack}
        variant="ghost"
        tooltip="Go Back"
        commandId="navigation.goBack"
        aria-label="Go back to previous location"
        iconOnly
        size="lg"
      >
        <ArrowLeftIcon />
      </Button>
      <Button
        type="button"
        onClick={() => void handleGoForward()}
        disabled={!canGoForward}
        variant="ghost"
        tooltip="Go Forward"
        commandId="navigation.goForward"
        aria-label="Go forward to next location"
        iconOnly
        size="lg"
      >
        <ArrowRightIcon />
      </Button>
    </div>
  );
}
