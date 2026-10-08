import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { commands } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/stores/buffer-index";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { getWindowDocumentState } from "@/features/window/utils/window-document-state";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";

export function useWindowDocumentState() {
  const projectName = useProjectStore((state) => state.projectName);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  // Derived inside the selector so typing in the active buffer doesn't re-render the app root.
  const activeBufferId = useActiveBufferId();
  const documentState = useBufferStore(
    useShallow((state) =>
      getWindowDocumentState({
        activeBuffer: getBufferById(state.buffers, activeBufferId) ?? null,
        projectName,
        rootFolderPath,
      }),
    ),
  );

  useEffect(() => {
    void commands
      .setWindowDocumentState(
        documentState.title,
        documentState.representedPath ?? null,
        documentState.isEdited,
      )
      .catch((error) => {
        console.error("Failed to update native window document state:", error);
      });
  }, [documentState.isEdited, documentState.representedPath, documentState.title]);
}
