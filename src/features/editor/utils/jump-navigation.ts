import { editorAPI } from "@/features/editor/extensions/api";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import type { JumpListEntry } from "@/features/editor/stores/jump-list-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { logger } from "./logger";

export async function navigateToJumpEntry(entry: JumpListEntry): Promise<boolean> {
  const bufferStore = useBufferStore.getState();

  // Hide completions and reset input timestamp to prevent completions from triggering
  const uiActions = useEditorUIStore.getState().actions;
  uiActions.setIsLspCompletionVisible(false);
  uiActions.setLastInputTimestamp(0);

  // Try to find the buffer by ID first, then by path
  let targetBuffer = bufferStore.buffers.find((b) => b.id === entry.bufferId);

  if (!targetBuffer) {
    targetBuffer = bufferStore.buffers.find((b) => b.path === entry.filePath);
  }

  if (!targetBuffer) {
    // Buffer is closed, try to reopen the file
    try {
      const content = await readFileContent(entry.filePath);
      const fileName = entry.filePath.split("/").pop() || "untitled";
      const bufferId = bufferStore.actions.openBuffer(entry.filePath, fileName, content);
      bufferStore.actions.setActiveBuffer(bufferId);
    } catch (error) {
      logger.error("JumpList", "Failed to reopen file:", entry.filePath, error);
      return false;
    }
  } else {
    bufferStore.actions.setActiveBuffer(targetBuffer.id);
  }

  // Set cursor position and scroll after buffer is ready
  setTimeout(() => {
    editorAPI.setCursorPosition({
      line: entry.line,
      column: entry.column,
      offset: entry.offset,
    });

    useEditorStateStore.getState().actions.setScroll(entry.scrollTop, entry.scrollLeft);

    logger.info("JumpList", `Jumped to ${entry.filePath}:${entry.line}:${entry.column}`);
  }, 100);

  return true;
}
