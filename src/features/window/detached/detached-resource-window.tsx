import { getCurrentWindow } from "@tauri-apps/api/window";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  isResourceBuffer,
  ResourceBufferBadge,
  ResourceBufferIcon,
  ResourceBufferView,
} from "@/features/panes/components/resource-buffer-view";
import { ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { Avatar } from "@/ui/avatar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import {
  parseResourceWindowPayload,
  type ResourceWindowMessage,
} from "./detached-resource-service";
import { AppQueryProvider } from "@/components/app-query-provider";
import { DetachedWindowShell } from "./detached-window-shell";
import { useDetachedWindow } from "./use-detached-window";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";

function closeWindow() {
  void getCurrentWindow().destroy().catch(console.error);
}

/**
 * A bare window showing one resource, such as a pull request or an issue. It
 * gets everything it needs from its URL, so it stands on its own; the owner
 * window is only asked to open links that belong in the workbench.
 */
export default function DetachedResourceWindow() {
  const activeBufferId = useActiveBufferId();
  const buffer = useBufferStore(
    (state) => state.buffers.find((item) => item.id === activeBufferId) ?? null,
  );
  const { error, openLocally, payload } = useDetachedWindow<ResourceWindowMessage>({
    kind: "resource",
    onMessage: () => undefined,
    onCloseRequest: closeWindow,
  });
  const request = useMemo(() => parseResourceWindowPayload(payload), [payload]);
  const opened = useRef(false);

  useEffect(() => {
    if (!request || opened.current) return;
    opened.current = true;
    useProjectStore.getState().actions.setRootFolderPath(request.workspacePath);
    openLocally(request.content);
  }, [openLocally, request]);

  const resource = buffer && isResourceBuffer(buffer) ? buffer : null;
  const avatarUrl =
    resource?.type === "pullRequest" || resource?.type === "githubIssue"
      ? resource.authorAvatarUrl
      : undefined;

  return (
    <AppQueryProvider>
      <DetachedWindowShell
        title={resource?.name ?? "Athas"}
        icon={
          resource ? (
            avatarUrl ? (
              <Avatar name={resource.name} src={avatarUrl} size="sm" />
            ) : (
              <ResourceBufferIcon buffer={resource} />
            )
          ) : null
        }
        actions={resource ? <ResourceBufferBadge buffer={resource} /> : null}
        error={error ?? (payload && !request ? "This window has no content to show." : null)}
      >
        {resource ? (
          <main className="min-h-0 min-w-0 flex-1">
            <Suspense fallback={<ViewerLoadingState label="Loading" layout="fill" />}>
              <ResourceBufferView buffer={resource} />
            </Suspense>
          </main>
        ) : request ? (
          <ViewerLoadingState label="Opening" layout="fill" />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nothing to show</EmptyTitle>
              <EmptyDescription>This content cannot open in its own window.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </DetachedWindowShell>
    </AppQueryProvider>
  );
}
