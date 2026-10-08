import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { savePendingPaneClose } from "@/features/panes/services/pane-content-save-service";
import UnsavedChangesDialog from "@/features/tabs/components/unsaved-changes-dialog";
import { useActiveWorkspaceId } from "@/features/workspace/stores/create-workspace-scoped-store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useMemo } from "react";

export function PendingBufferCloseDialog() {
  const workspaceId = useActiveWorkspaceId();
  const pendingClose = useBufferStore.use.pendingClose();
  const fileName = useBufferStore(
    (state) => state.buffers.find((buffer) => buffer.id === pendingClose?.bufferId)?.name,
  );
  const owner = useBufferStore.getStore(workspaceId);
  const decisionKey = useMemo(() => ({ workspaceId, pendingClose }), [workspaceId, pendingClose]);
  if (!pendingClose) return null;
  const isCurrent = () =>
    workspaceRuntimeRegistry.getActiveWorkspaceId() === workspaceId &&
    workspaceRuntimeRegistry.getWorkspace(workspaceId)?.stores.get("editor-buffer") === owner &&
    owner.getState().pendingClose === pendingClose;
  return (
    <UnsavedChangesDialog
      decisionKey={decisionKey}
      fileName={fileName ?? "File"}
      onSave={() =>
        isCurrent() ? savePendingPaneClose(workspaceId, pendingClose) : Promise.resolve(false)
      }
      onDiscard={() => {
        if (isCurrent()) owner.getState().actions.confirmCloseWithoutSaving();
      }}
      onCancel={() => {
        if (isCurrent()) owner.getState().actions.cancelPendingClose();
      }}
    />
  );
}
