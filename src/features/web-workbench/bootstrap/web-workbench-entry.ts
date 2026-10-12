import { enableMapSet } from "immer";
import { version as appVersion } from "@/../package.json";
import {
  SAMPLE_HOME,
  SAMPLE_ROOT,
  sampleFiles,
  sampleRepository,
} from "@/features/web-workbench/data/sample-project";
import {
  blockExternalFetch,
  installWebBackend,
} from "@/features/web-workbench/bootstrap/install-web-backend";
import { startRemoteWorkspace } from "@/features/web-workbench/bootstrap/remote-workspace";
import { MemoryFileSystem } from "@/features/web-workbench/services/memory-file-system";
import { MemoryGitRepository } from "@/features/web-workbench/services/memory-git";
import { setScriptedAgentFiles } from "@/features/web-workbench/services/scripted-network";
import { createWebBackend } from "@/features/web-workbench/services/web-backend";
import type { PaneGroup, PaneNode } from "@/features/panes/types/pane.types";

const params = new URL(window.location.href).searchParams;
const themeType = params.get("theme") === "light" ? "light" : "dark";

// In workspace mode the athas.dev dashboard hands the editor a cloud workspace session by
// postMessage; without one the editor opens the in-memory sample project.
const remote =
  params.get("mode") === "workspace" && window.parent !== window
    ? await startRemoteWorkspace(appVersion)
    : null;

function createSampleBackend() {
  const fs = new MemoryFileSystem(SAMPLE_ROOT, sampleFiles, [SAMPLE_HOME]);
  const git = new MemoryGitRepository(fs, SAMPLE_ROOT, sampleRepository);
  return createWebBackend({ home: SAMPLE_HOME, fs, git, appVersion });
}

const backend = remote?.backend ?? createSampleBackend();
backend.seedStore("settings.json", {
  theme: `athas-${themeType}`,
  product_onboarding_state_v1: { lastSeenVersion: appVersion, completedVersion: appVersion },
});

installWebBackend(backend);
blockExternalFetch();
enableMapSet();

await import("@/main");

const { useFileSystemStore } = await import("@/features/file-system/stores/file-system.store");

async function waitFor(check: () => boolean, timeoutMs = 10_000) {
  const startedAt = performance.now();
  while (!check()) {
    if (performance.now() - startedAt > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

function announceReady() {
  document.documentElement.dataset.webWorkbenchReady = "true";
  if (window.parent !== window) {
    // Carries no data, so any embedding origin may hear it; CSP frame-ancestors decides who embeds.
    window.parent.postMessage({ type: "athas-web-editor:ready" }, "*");
  }
}

await waitFor(() => Boolean(document.querySelector("#root")?.childElementCount));

if (remote) await useFileSystemStore.getState().handleOpenFolderByPath(remote.workspace.root);
else await openSampleProject();
announceReady();

async function openSampleProject() {
  await useFileSystemStore.getState().handleOpenFolderByPath(SAMPLE_ROOT);

  const fileSystem = useFileSystemStore.getState();
  for (const path of ["package.json", "src/app/page.tsx", "tsconfig.json"]) {
    await fileSystem.handleFileSelect(`${SAMPLE_ROOT}/${path}`, false);
  }

  const { useAIChatStore } = await import("@/features/ai/stores/ai-chat.store");
  const chatActions = useAIChatStore.getState().actions;
  const chatId = chatActions.createNewChat(undefined, { activate: true });
  chatActions.updateChatTitle(chatId, "Should noEmit be false here?");
  const askedAt = new Date(Date.now() - 4 * 60_000);
  chatActions.addMessage(chatId, {
    id: "sample-question",
    role: "user",
    content: "Should noEmit be false here?",
    timestamp: askedAt,
  });
  chatActions.addMessage(chatId, {
    id: "sample-answer",
    role: "assistant",
    timestamp: new Date(askedAt.getTime() + 20_000),
    content: [
      "No. In `tsconfig.json`, `noEmit: true` should stay `true`.",
      "",
      "This is a Next app: `next build` handles compiling and bundling, and `tsc` only type checks through the `typecheck` script in `package.json`. Setting `noEmit` to `false` would make TypeScript emit stray `.js` files next to your sources.",
    ].join("\n"),
    toolCalls: [
      {
        id: "sample-read",
        name: "read_file",
        input: { path: "tsconfig.json" },
        output: "35 lines",
        timestamp: askedAt,
        isComplete: true,
      },
      {
        id: "sample-search",
        name: "search_files",
        input: { query: "noEmit|tsc|typecheck" },
        output: "2 matches",
        timestamp: askedAt,
        isComplete: true,
      },
    ],
  });

  // Put the agent session beside the editor, the way the desktop app is usually laid out.
  const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
  const { usePaneStore } = await import("@/features/panes/stores/pane.store");

  function findPane(node: PaneNode, paneId: string): PaneGroup | null {
    if (node.type === "group") return node.id === paneId ? node : null;
    return findPane(node.children[0], paneId) ?? findPane(node.children[1], paneId);
  }

  const editorPaneId = usePaneStore.getState().activePaneId;
  const editorBufferId = findPane(usePaneStore.getState().root, editorPaneId)?.activeBufferId;
  const agentBufferId = useBufferStore.getState().actions.openAgentBuffer(chatId);
  const paneActions = usePaneStore.getState().actions;

  // The scripted agent reads the file the user asks about, or the one showing in the editor.
  setScriptedAgentFiles({
    paths: Object.keys(sampleFiles),
    active: () => {
      const pane = findPane(usePaneStore.getState().root, editorPaneId);
      const buffer = useBufferStore
        .getState()
        .buffers.find((candidate) => candidate.id === pane?.activeBufferId);
      const path = buffer && "path" in buffer ? String(buffer.path) : "";
      return path.startsWith(`${SAMPLE_ROOT}/`) ? path.slice(SAMPLE_ROOT.length + 1) : null;
    },
  });
  paneActions.removeBufferFromPane(editorPaneId, agentBufferId, true);
  paneActions.splitPane(editorPaneId, "horizontal", agentBufferId);
  if (editorBufferId) paneActions.activatePaneBuffer(editorPaneId, editorBufferId);
  const rootNode = usePaneStore.getState().root;
  if (rootNode.type === "split") paneActions.updatePaneSizes(rootNode.id, [63, 37]);
  paneActions.setActivePane(editorPaneId);
}
