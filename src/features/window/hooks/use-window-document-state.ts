import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { useProjectStore } from "@/features/window/stores/project.store";
import { getWindowDocumentState } from "@/features/window/utils/window-document-state";

export function useWindowDocumentState() {
  const projectName = useProjectStore((state) => state.projectName);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  // Derived inside the selector so typing in the active buffer doesn't re-render the app root.
  const documentState = useBufferStore((state) =>
    getWindowDocumentState({
      activeBuffer: getBufferById(state.buffers, state.activeBufferId) ?? null,
      projectName,
      rootFolderPath,
    }),
  );

  useEffect(() => {
    void invoke("set_window_document_state", {
      title: documentState.title,
      representedPath: documentState.representedPath,
      isEdited: documentState.isEdited,
    }).catch((error) => {
      console.error("Failed to update native window document state:", error);
    });
  }, [documentState.isEdited, documentState.representedPath, documentState.title]);
}
