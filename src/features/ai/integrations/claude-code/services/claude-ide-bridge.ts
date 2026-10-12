import { commands } from "@/bindings/commands";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import type { useProjectStore } from "@/features/workspace/stores/project.store";
import { cancelClaudeDiff } from "./claude-ide-diff-review";
import { isLocalFilePath, readActiveEditorSelection } from "./claude-ide-selection";
import { type ClaudeIdeRequest, runClaudeIdeTool } from "./claude-ide-tools";

const REQUEST_EVENT = "claude-ide-request";
const CANCEL_EVENT = "claude-ide-cancel";
const SELECTION_DEBOUNCE_MS = 120;

type ProjectState = ReturnType<typeof useProjectStore.getState>;

let cleanups: Array<() => void> = [];

function currentWindowLabel(): string | null {
  try {
    return getCurrentWebviewWindow().label;
  } catch {
    return null;
  }
}

/** Runs the tool Claude asked this window for and sends back its result or error. */
export async function answerClaudeIdeRequest(request: ClaudeIdeRequest) {
  if (request.windowLabel !== currentWindowLabel()) return;
  try {
    const content = await runClaudeIdeTool(request);
    await commands.respondClaudeIdeRequest(request.requestId, { content, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await commands.respondClaudeIdeRequest(request.requestId, { content: [], error: message });
  }
}

/** Every local folder open in this window's workspaces, primary roots first. */
export function collectWorkspaceFolders(states: ProjectState[]): string[] {
  const folders: string[] = [];
  const add = (path: string | undefined) => {
    if (path && isLocalFilePath(path) && !folders.includes(path)) folders.push(path);
  };
  for (const state of states) add(state.rootFolderPath);
  for (const state of states) for (const folder of state.workspaceFolders) add(folder.path);
  return folders;
}

function syncWorkspaceFolders() {
  let reported = "";
  const report = () => {
    const folders = collectWorkspaceFolders(
      workspaceRuntimeRegistry
        .getExistingStores<ProjectState>("project")
        .map((store) => store.getState()),
    );
    const key = JSON.stringify(folders);
    if (key === reported) return;
    reported = key;
    void commands.claudeIdeSetWorkspaceFolders(folders).catch(() => {});
  };
  report();
  return workspaceRuntimeRegistry.subscribeToStoreKey("project", report);
}

function syncSelection() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (typeof document !== "undefined" && !document.hasFocus()) return;
      void commands.claudeIdeUpdateSelection(readActiveEditorSelection()).catch(() => {});
    }, SELECTION_DEBOUNCE_MS);
  };
  const unsubscribeEditor = useEditorStateStore.subscribe((state, previous) => {
    if (
      state.cursorPosition !== previous.cursorPosition ||
      state.selection !== previous.selection ||
      state.activeEditorViewKey !== previous.activeEditorViewKey
    ) {
      schedule();
    }
  });
  const unsubscribeBuffers = useBufferStore.subscribe(schedule);
  return () => {
    if (timer !== null) clearTimeout(timer);
    unsubscribeEditor();
    unsubscribeBuffers();
  };
}

function syncEnabledSetting() {
  return useSettingsStore.subscribe((state, previous) => {
    const enabled = state.settings.claudeCodeIdeIntegration;
    if (enabled === previous.settings.claudeCodeIdeIntegration) return;
    void commands.claudeIdeSetEnabled(enabled).catch((error) => {
      console.error("Failed to switch the Claude Code integration:", error);
    });
  });
}

/** Sends the active editor's selection, or its file, to Claude Code as an @-mention. */
export async function sendSelectionToClaudeCode() {
  const selection = readActiveEditorSelection();
  if (!selection) {
    toast.error("Open a file to send it to Claude Code");
    return;
  }
  const hasRange = selection.text.length > 0;
  try {
    await commands.claudeIdeAtMention(
      selection.filePath,
      hasRange ? selection.start.line : null,
      hasRange ? selection.end.line : null,
    );
  } catch (error) {
    toast.error("Could not send the selection to Claude Code", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function initializeClaudeIdeBridge() {
  await cleanupClaudeIdeBridge();
  const [unlistenRequests, unlistenCancels]: UnlistenFn[] = await Promise.all([
    listen<ClaudeIdeRequest>(REQUEST_EVENT, (event) => {
      answerClaudeIdeRequest(event.payload).catch((error) => {
        console.error("Failed to answer a Claude Code tool call:", error);
      });
    }),
    listen<{ requestId: string }>(CANCEL_EVENT, (event) => {
      cancelClaudeDiff(event.payload.requestId);
    }),
  ]);
  cleanups = [
    unlistenRequests,
    unlistenCancels,
    syncWorkspaceFolders(),
    syncSelection(),
    syncEnabledSetting(),
  ];
}

export async function cleanupClaudeIdeBridge() {
  const pending = cleanups;
  cleanups = [];
  for (const cleanup of pending) cleanup();
}
