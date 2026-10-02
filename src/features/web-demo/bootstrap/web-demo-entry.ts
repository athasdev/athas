import { enableMapSet } from "immer";
import { ensureStartupAppearanceApplied } from "@/features/settings/lib/appearance-bootstrap";
import { DEMO_ROOT, demoFiles } from "@/features/web-demo/data/demo-project";
import { installDemoBackend, seedStore } from "@/features/web-demo/services/demo-backend";
import { blockExternalFetch, setDemoAgentFiles } from "@/features/web-demo/services/demo-network";

// The demo runs on the athas.dev origin inside an iframe. Keep its persisted UI state in memory
// so it never reads or writes the site's own storage and every visit starts fresh.
function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}
Object.defineProperty(window, "localStorage", { value: createMemoryStorage() });
Object.defineProperty(window, "sessionStorage", { value: createMemoryStorage() });

const themeType =
  new URL(window.location.href).searchParams.get("theme") === "light" ? "light" : "dark";

seedStore("settings.json", {
  theme: `athas-${themeType}`,
  product_onboarding_state_v1: { lastSeenVersion: "0.15.1", completedVersion: "0.15.1" },
});

installDemoBackend();
blockExternalFetch();
enableMapSet();
ensureStartupAppearanceApplied();

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
await useFileSystemStore.getState().handleOpenFolderByPath(DEMO_ROOT);

const fileSystem = useFileSystemStore.getState();
for (const path of ["package.json", "src/app/page.tsx", "tsconfig.json"]) {
  await fileSystem.handleFileSelect(`${DEMO_ROOT}/${path}`, false);
}

const { useAIChatStore } = await import("@/features/ai/stores/ai-chat.store");
const chatActions = useAIChatStore.getState().actions;
const chatId = chatActions.createNewChat(undefined, { activate: true });
chatActions.updateChatTitle(chatId, "Should noEmit be false here?");
const askedAt = new Date(Date.now() - 4 * 60_000);
chatActions.addMessage(chatId, {
  id: "demo-question",
  role: "user",
  content: "Should noEmit be false here?",
  timestamp: askedAt,
});
chatActions.addMessage(chatId, {
  id: "demo-answer",
  role: "assistant",
  timestamp: new Date(askedAt.getTime() + 20_000),
  content: [
    "No. In `www/tsconfig.json`, `noEmit: true` should stay `true`.",
    "",
    "This is a Next app: `next build` handles compiling and bundling, and `tsc` only type checks through the `typecheck` script in `www/package.json`. Setting `noEmit` to `false` would make TypeScript emit stray `.js` files next to your sources.",
  ].join("\n"),
  toolCalls: [
    {
      name: "read_file",
      input: { path: "tsconfig.json" },
      output: "35 lines",
      timestamp: askedAt,
      isComplete: true,
    },
    {
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

const editorPaneId = usePaneStore.getState().activePaneId;
const editorBufferId = useBufferStore.getState().activeBufferId;
const agentBufferId = useBufferStore.getState().actions.openAgentBuffer(chatId);
const paneActions = usePaneStore.getState().actions;

type PaneTreeNode =
  | { type: "group"; id: string; activeBufferId: string | null }
  | { type: "split"; children: [PaneTreeNode, PaneTreeNode] };

function findPane(node: PaneTreeNode, paneId: string): { activeBufferId: string | null } | null {
  if (node.type === "group") return node.id === paneId ? node : null;
  return findPane(node.children[0], paneId) ?? findPane(node.children[1], paneId);
}

// The scripted agent reads the file the visitor asks about, or the one showing in the editor.
setDemoAgentFiles({
  paths: Object.keys(demoFiles),
  active: () => {
    const pane = findPane(usePaneStore.getState().root as PaneTreeNode, editorPaneId);
    const buffer = useBufferStore
      .getState()
      .buffers.find((candidate) => candidate.id === pane?.activeBufferId);
    const path = buffer && "path" in buffer ? String(buffer.path) : "";
    return path.startsWith(`${DEMO_ROOT}/`) ? path.slice(DEMO_ROOT.length + 1) : null;
  },
});
paneActions.removeBufferFromPane(editorPaneId, agentBufferId, true);
paneActions.splitPane(editorPaneId, "horizontal", agentBufferId);
if (editorBufferId) paneActions.activatePaneBuffer(editorPaneId, editorBufferId);
const rootNode = usePaneStore.getState().root;
if (rootNode.type === "split") paneActions.updatePaneSizes(rootNode.id, [63, 37]);
paneActions.setActivePane(editorPaneId);

// A browser tab has no native window controls, so draw the macOS ones in the title bar inset.
const windowControls = document.createElement("div");
windowControls.setAttribute("aria-hidden", "true");
windowControls.style.cssText =
  "position:fixed;top:0;left:14px;height:var(--athas-title-bar-height,2.5rem);display:flex;align-items:center;gap:8px;z-index:60;pointer-events:none";
for (const color of ["#ff5f57", "#febc2e", "#28c840"]) {
  const dot = document.createElement("span");
  dot.style.cssText = `width:12px;height:12px;border-radius:9999px;background:${color};box-shadow:inset 0 0 0 0.5px rgba(0,0,0,0.12)`;
  windowControls.append(dot);
}
document.body.append(windowControls);

// Tell the embedding page (athas.dev) that the workbench is ready to show, once the requested
// theme has replaced the startup one.
const expectedBackground = themeType === "light" ? "#ffffff" : "#18191b";
await waitFor(
  () =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--background")
      .trim()
      .toLowerCase() === expectedBackground,
  3_000,
);
await new Promise((resolve) => setTimeout(resolve, 100));
if (window.parent !== window) {
  window.parent.postMessage({ type: "athas-demo:ready" }, window.location.origin);
}
