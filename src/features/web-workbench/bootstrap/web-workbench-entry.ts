import { emit } from "@tauri-apps/api/event";
import { enableMapSet } from "immer";
import { lazy } from "react";
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
import {
  createSwitchableBackend,
  createWorkspaceSwitcher,
} from "@/features/web-workbench/bootstrap/remote-workspace";
import { MemoryFileSystem } from "@/features/web-workbench/services/memory-file-system";
import { MemoryGitRepository } from "@/features/web-workbench/services/memory-git";
import { setScriptedAgentFiles } from "@/features/web-workbench/services/scripted-network";
import { createWebBackend } from "@/features/web-workbench/services/web-backend";
import { createWebsiteApi } from "@/features/web-workbench/services/website-api";
import type { PaneGroup, PaneNode } from "@/features/panes/types/pane.types";
import { registerWebContributions } from "@/utils/web-contributions";

// Athas in the browser at athas.dev/app. It opens the in-memory sample project; signed-in Pro
// users can open their GitHub repositories in cloud workspaces from the project picker.
const themeType = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

const fs = new MemoryFileSystem(SAMPLE_ROOT, sampleFiles, [SAMPLE_HOME]);
const git = new MemoryGitRepository(fs, SAMPLE_ROOT, sampleRepository);
const sample = createWebBackend({ home: SAMPLE_HOME, fs, git, appVersion });
sample.seedStore("settings.json", {
  theme: `athas-${themeType}`,
  product_onboarding_state_v1: { lastSeenVersion: appVersion, completedVersion: appVersion },
});
const backend = createSwitchableBackend(sample);

installWebBackend(backend);
const websiteFetch = blockExternalFetch();
enableMapSet();
registerWebContributions({
  AccountMenu: lazy(() => import("@/features/web-workbench/components/web-account-menu")),
  GithubRepositoryContent: lazy(
    () => import("@/features/web-workbench/components/github-repository-content"),
  ),
});

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

await waitFor(() => Boolean(document.querySelector("#root")?.childElementCount));
await openSampleProject();
// The workbench itself loads lazily behind the boot screen; its notices need it mounted.
await waitFor(() => Boolean(document.querySelector("#root .window-container")));
document.documentElement.dataset.webWorkbenchReady = "true";

const { useWorkspaceTabsStore } = await import("@/features/workspace/stores/workspace-tabs.store");
const { startWebApp } = await import("@/features/web-workbench/bootstrap/web-app");
const switcher = createWorkspaceSwitcher({
  backend,
  sample,
  sampleRoot: SAMPLE_ROOT,
  openFolder: (path) => useFileSystemStore.getState().handleOpenFolderByPath(path),
  closeFolder: async (path) => {
    const tab = useWorkspaceTabsStore.getState().projectTabs.find((item) => item.path === path);
    if (tab) await useFileSystemStore.getState().closeProject(tab.id);
  },
  emit: (event, payload) => emit(event, payload),
});
await startWebApp({
  api: createWebsiteApi(websiteFetch),
  activate: switcher.activate,
  deactivate: switcher.deactivate,
});

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
