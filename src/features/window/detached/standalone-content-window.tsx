import { getCurrentWindow } from "@tauri-apps/api/window";
import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import {
  isResourceBuffer,
  ResourceBufferView,
} from "@/features/panes/components/resource-buffer-view";
import { TerminalHost } from "@/features/terminal/components/terminal-host";
import { TerminalTab } from "@/features/terminal/components/terminal-tab";
import { useProjectStore } from "@/features/window/stores/project.store";
import { ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import { parseResourceWindowPayload } from "./detached-resource-service";
import { DetachedWindowShell } from "./detached-window-shell";
import { useDetachedWindow } from "./use-detached-window";

const SettingsView = lazy(() => import("@/features/settings/components/settings-workbench-view"));
const ExtensionsView = lazy(() =>
  import("@/extensions/ui/components/extensions-view").then((module) => ({
    default: module.ExtensionsView,
  })),
);

const ExtensionDetails = lazy(() =>
  import("@/extensions/ui/components/extensions-view").then((module) => ({
    default: module.ExtensionDetails,
  })),
);

function closeWindow() {
  void getCurrentWindow().destroy().catch(console.error);
}

export default function StandaloneContentWindow() {
  const { ready, error, payload, openLocally } = useDetachedWindow({
    kind: "standalone",
    onMessage: () => undefined,
    onCloseRequest: closeWindow,
  });
  const request = useMemo(() => parseResourceWindowPayload(payload), [payload]);
  const opened = useRef(false);
  const buffer = useBufferStore((state) =>
    state.buffers.find((item) => item.id === state.activeBufferId),
  );

  useEffect(() => {
    if (!ready || !request || opened.current) return;
    opened.current = true;
    useProjectStore.getState().actions.setRootFolderPath(request.workspacePath);
    useFileSystemStore.setState({ rootFolderPath: request.workspacePath });
    openLocally(request.content);
  }, [ready, request, openLocally]);

  useEffect(() => {
    if (opened.current && !buffer) closeWindow();
  }, [buffer]);

  return (
    <DetachedWindowShell
      title={buffer?.name ?? "Athas"}
      error={error ?? (!request ? "This window has no content to show." : null)}
      runtime={ready ? <TerminalHost /> : null}
    >
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Suspense fallback={<ViewerLoadingState label="Opening" layout="fill" />}>
          {buffer?.type === "terminal" ? (
            <TerminalTab
              bufferId={buffer.id}
              sessionId={buffer.sessionId}
              shell={buffer.shell}
              initialCommand={buffer.initialCommand}
              workingDirectory={buffer.workingDirectory}
              remoteConnectionId={buffer.remoteConnectionId}
            />
          ) : buffer?.type === "settings" ? (
            <SettingsView />
          ) : buffer?.type === "extensions" ? (
            <ExtensionsView />
          ) : buffer?.type === "extension" ? (
            <ExtensionDetails extensionId={buffer.extensionId} />
          ) : buffer && isResourceBuffer(buffer) ? (
            <ResourceBufferView buffer={buffer} />
          ) : (
            <ViewerLoadingState label="Opening" layout="fill" />
          )}
        </Suspense>
      </main>
    </DetachedWindowShell>
  );
}
