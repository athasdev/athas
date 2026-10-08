import { getCurrentWindow } from "@tauri-apps/api/window";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { registerExtensionPaneViews } from "@/extensions/ui/services/extension-pane-views";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { registerAiEditorFeatures } from "@/features/ai/services/ai-editor-features";
import { registerGitHubResourceViews } from "@/features/github/services/github-resource-views";
import { getPaneView, isResourceBuffer } from "@/features/panes/services/pane-view-registry";
import { registerSettingsViews } from "@/features/settings/services/settings-views";
import { TerminalHost } from "@/features/terminal/components/terminal-host";
import { registerStandaloneTerminalView } from "@/features/terminal/services/standalone-terminal-view";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { ViewerLoadingState } from "@/ui/viewer-state";
import { parseResourceWindowPayload } from "./services/detached-resource-service";
import { AppQueryProvider } from "@/components/app-query-provider";
import { DetachedWindowShell } from "./detached-window-shell";
import { DetachedBufferView } from "./resource-view";
import { useDetachedWindow } from "./hooks/use-detached-window";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";

registerStandaloneTerminalView();
registerSettingsViews();
registerExtensionPaneViews();
registerGitHubResourceViews();
registerAiEditorFeatures();

const STANDALONE_TYPES = new Set(["terminal", "settings", "extensions", "extension"]);

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
  const activeBufferId = useActiveBufferId();
  const buffer = useBufferStore((state) =>
    state.buffers.find((item) => item.id === activeBufferId),
  );

  useEffect(() => {
    if (!ready || !request || opened.current) return;
    opened.current = true;
    void getPaneView(request.content.type)?.prefetch?.();
    useProjectStore.getState().actions.setRootFolderPath(request.workspacePath);
    openLocally(request.content);
  }, [ready, request, openLocally]);

  useEffect(() => {
    if (opened.current && !buffer) closeWindow();
  }, [buffer]);

  return (
    <AppQueryProvider>
      <DetachedWindowShell
        title={buffer?.name ?? "Athas"}
        error={error ?? (!request ? "This window has no content to show." : null)}
        runtime={ready ? <TerminalHost /> : null}
      >
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Suspense fallback={<ViewerLoadingState label="Opening" layout="fill" />}>
            {buffer && (STANDALONE_TYPES.has(buffer.type) || isResourceBuffer(buffer)) ? (
              <DetachedBufferView buffer={buffer} />
            ) : (
              <ViewerLoadingState label="Opening" layout="fill" />
            )}
          </Suspense>
        </main>
      </DetachedWindowShell>
    </AppQueryProvider>
  );
}
