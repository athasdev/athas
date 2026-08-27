import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { getWindowDocumentState } from "@/features/window/utils/window-document-state";

export function useWindowDocumentState() {
  const activeBuffer = useBufferStore(
    (state) => state.buffers.find((buffer) => buffer.id === state.activeBufferId) ?? null,
  );
  const projectName = useProjectStore((state) => state.projectName);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const documentState = useMemo(
    () => getWindowDocumentState({ activeBuffer, projectName, rootFolderPath }),
    [activeBuffer, projectName, rootFolderPath],
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
