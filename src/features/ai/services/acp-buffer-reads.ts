import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getSourceEditorBufferByPath } from "@/features/editor/utils/buffer-index";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import type { AcpBufferReadRequest } from "@/features/ai/types/acp.types";

const ACP_BUFFER_READ_EVENT = "acp-buffer-read";

let unlistenBufferReads: UnlistenFn | null = null;

/**
 * What this window's editor holds for `path`, unsaved changes included, or null when no
 * workspace in the window has the file open.
 */
export function getOpenBufferContent(path: string): string | null {
  const bufferStates = [
    useBufferStore.getState(),
    ...workspaceRuntimeRegistry
      .getExistingStores<ReturnType<typeof useBufferStore.getState>>("editor-buffer")
      .map((store) => store.getState()),
  ];
  for (const state of bufferStates) {
    const buffer = getSourceEditorBufferByPath(state.buffers, path);
    if (buffer) return buffer.content;
  }
  return null;
}

/** Answers an agent's `fs/read_text_file` with the open buffer, so it sees unsaved edits. */
export async function answerAcpBufferRead({ requestId, path }: AcpBufferReadRequest) {
  await invoke("respond_acp_buffer_read", { requestId, content: getOpenBufferContent(path) });
}

export async function initializeAcpBufferReads() {
  await cleanupAcpBufferReads();
  unlistenBufferReads = await listen<AcpBufferReadRequest>(ACP_BUFFER_READ_EVENT, (event) => {
    answerAcpBufferRead(event.payload).catch((error) => {
      console.error("Failed to answer an agent's file read:", error);
    });
  });
}

export async function cleanupAcpBufferReads() {
  const unlisten = unlistenBufferReads;
  unlistenBufferReads = null;
  unlisten?.();
}
