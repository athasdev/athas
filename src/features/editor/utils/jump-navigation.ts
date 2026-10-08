import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { JumpListEntry } from "@/features/editor/stores/jump-list.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { getBufferById, getBufferByPath } from "@/features/editor/utils/buffer-index";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { logger } from "./logger";

export async function navigateToJumpEntry(entry: JumpListEntry): Promise<boolean> {
  const bufferStore = useBufferStore.getState();

  // Try to find the buffer by ID first, then by path
  let targetBuffer = getBufferById(bufferStore.buffers, entry.bufferId);

  if (!targetBuffer) {
    targetBuffer = getBufferByPath(bufferStore.buffers, entry.filePath);
  }

  let bufferId: string;
  if (!targetBuffer) {
    // Buffer is closed, try to reopen the file
    try {
      const content = await readFileContent(entry.filePath);
      const fileName = entry.filePath.split("/").pop() || "untitled";
      bufferId = bufferStore.actions.openBuffer(entry.filePath, fileName, content);
      bufferStore.actions.setActiveBuffer(bufferId);
    } catch (error) {
      logger.error("JumpList", "Failed to reopen file:", entry.filePath, error);
      return false;
    }
  } else {
    bufferId = targetBuffer.id;
    bufferStore.actions.setActiveBuffer(bufferId);
  }

  // The editor showing the buffer moves the cursor and centers it once it is ready. Focus stays
  // where it is, as it did when the jump list set the cursor directly.
  const position = { line: entry.line, column: entry.column, offset: entry.offset };
  useEditorStateStore.getState().actions.requestNavigation({
    bufferId,
    range: { start: position, end: position },
    focus: false,
  });
  logger.info("JumpList", `Jumped to ${entry.filePath}:${entry.line}:${entry.column}`);

  return true;
}
