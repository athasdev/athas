import { getCurrentWindow } from "@tauri-apps/api/window";
import { Suspense, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import {
  isResourceBuffer,
  ResourceBufferIcon,
  ResourceBufferView,
  toResourceContentSpec,
} from "@/features/panes/components/resource-buffer-view";
import { ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { ArrowCounterClockwiseIcon } from "@/ui/icons";
import type { ResourceWindowMessage } from "./detached-resource-service";
import { DetachedWindowShell } from "./detached-window-shell";
import { useDetachedWindow } from "./use-detached-window";

function closeWindow() {
  void getCurrentWindow().destroy().catch(console.error);
}

/**
 * A bare window showing one resource, such as a pull request or an issue. The
 * owner window keeps its own copy; closing this window just closes it.
 */
export default function DetachedResourceWindow() {
  const [ready, setReady] = useState(false);
  const buffer = useBufferStore(
    (state) => state.buffers.find((item) => item.id === state.activeBufferId) ?? null,
  );
  const { error, post } = useDetachedWindow<ResourceWindowMessage>({
    kind: "resource",
    onMessage: (message, connection) => {
      if (message.type !== "initialize") return;
      useProjectStore.getState().actions.setRootFolderPath(message.workspacePath);
      useFileSystemStore.setState({ rootFolderPath: message.workspacePath });
      connection.openLocally(message.content);
      setReady(true);
    },
    onCloseRequest: closeWindow,
  });
  const resource = buffer && isResourceBuffer(buffer) ? buffer : null;

  const moveToOwner = () => {
    const content = resource ? toResourceContentSpec(resource) : null;
    if (!content) return;
    post({ type: "workbench", content });
    closeWindow();
  };

  return (
    <DetachedWindowShell
      title={resource?.name ?? "Athas"}
      icon={resource ? <ResourceBufferIcon buffer={resource} /> : null}
      actions={
        resource ? (
          <Button
            type="button"
            variant="ghost"
            size="chrome"
            onClick={moveToOwner}
            tooltip="Open this in the main window and close this one"
            shortcut="mod+w"
            aria-label="Open in the main window"
          >
            <ArrowCounterClockwiseIcon />
            Main window
          </Button>
        ) : null
      }
      error={error}
      pending={ready ? null : { title: "Opening…", description: "Connecting to the main window." }}
    >
      {resource ? (
        <main className="min-h-0 min-w-0 flex-1">
          <Suspense fallback={<ViewerLoadingState label="Loading" layout="fill" />}>
            <ResourceBufferView buffer={resource} />
          </Suspense>
        </main>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing to show</EmptyTitle>
            <EmptyDescription>This content cannot open in its own window.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </DetachedWindowShell>
  );
}
