import { Emitter, Range as MonacoRange, editor as monacoEditor, languages } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import {
  agentEditDecorations,
  agentEditLensAtLine,
} from "@/features/ai/lib/agent-edit-decorations";
import { agentEditLenses, type AgentEditLens } from "@/features/ai/lib/agent-edit-lenses";
import { keepAgentHunk, rejectAgentHunk } from "@/features/ai/services/agent-edits-service";
import { useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { filePathFromUri } from "@/features/editor/lsp/workspace-edit";
import { useKeymapStore } from "@/features/keymaps/stores/keymaps.store";
import { showToast } from "@/features/layout/contexts/toast-context";
import { filePathFromAthasModelUri } from "./model-uri";

const KEEP_COMMAND = "athas.keepAgentHunk";
const REJECT_COMMAND = "athas.rejectAgentHunk";
/** Keymap context: the focused editor shows unreviewed agent hunks. */
export const AGENT_EDIT_HUNKS_CONTEXT = "agentEditHunks";
/** Lets a burst of typing or store updates redraw the hunks once. */
const RENDER_DELAY_MS = 50;

type CodeEditor = Monaco.editor.ICodeEditor;

let registered = false;
const renderers = new Map<CodeEditor, () => void>();
const lensesByEditor = new WeakMap<CodeEditor, AgentEditLens[]>();
let focusedEditor: CodeEditor | null = null;

function filePathFromModel(model: Monaco.editor.ITextModel): string | null {
  if (model.uri.scheme === "file") return filePathFromUri(model.uri.toString());
  if (model.uri.scheme === "athas") {
    return filePathFromAthasModelUri(model.uri.path, model.uri.query);
  }
  return null;
}

function lensesForModel(model: Monaco.editor.ITextModel | null): AgentEditLens[] {
  const path = model && filePathFromModel(model);
  if (!model || !path) return [];
  const { byChat } = useAgentEditsStore.getState();
  // Reading the model's text is the costly part; skip it for files no agent edited.
  if (!Object.values(byChat).some((entries) => entries[path])) return [];
  return agentEditLenses(byChat, path, model.getValue());
}

function syncKeymapContext() {
  const hasHunks = !!focusedEditor && (lensesByEditor.get(focusedEditor)?.length ?? 0) > 0;
  useKeymapStore.getState().actions.setContext(AGENT_EDIT_HUNKS_CONTEXT, hasHunks);
}

/** Names the chat on its actions when more than one chat's agent edited the file. */
function actionTitle(action: string, lens: AgentEditLens, chatCount: number): string {
  if (chatCount < 2) return action;
  const title = useAIChatStore.getState().chats.find((chat) => chat.id === lens.chatId)?.title;
  return title ? `${action} (${title})` : action;
}

/** The agent's removed lines, drawn in a view zone above the hunk the way a diff shows them. */
function removedLinesNode(editor: CodeEditor, lines: string[]): HTMLElement {
  const fontInfo = editor.getOption(monacoEditor.EditorOption.fontInfo);
  const lineHeight = editor.getOption(monacoEditor.EditorOption.lineHeight);
  const node = document.createElement("div");
  node.className = "agent-edit-removed-lines";
  node.setAttribute("aria-label", "Lines the agent removed");
  node.style.fontFamily = fontInfo.fontFamily;
  node.style.fontSize = `${fontInfo.fontSize}px`;
  node.style.lineHeight = `${lineHeight}px`;
  node.style.tabSize = String(editor.getModel()?.getOptions().tabSize ?? 4);
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "agent-edit-removed-line";
    row.textContent = line.length > 0 ? line : " ";
    node.append(row);
  }
  return node;
}

/** Draws an editor's unreviewed agent hunks: added lines in green, removed lines above them. */
function attachEditor(editor: CodeEditor) {
  if (renderers.has(editor)) return;
  const decorations = editor.createDecorationsCollection();
  let zoneIds: string[] = [];
  let renderedKey = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    const lenses = lensesForModel(editor.getModel());
    lensesByEditor.set(editor, lenses);
    if (editor === focusedEditor) syncKeymapContext();
    const items = agentEditDecorations(lenses);
    const key = JSON.stringify(
      items.map((item) => [item.addedLines, item.afterLineNumber, item.removedLines]),
    );
    if (key === renderedKey) return;
    renderedKey = key;

    decorations.set(
      items.flatMap((item) =>
        item.addedLines
          ? [
              {
                range: new MonacoRange(item.addedLines.start, 1, item.addedLines.end, 1),
                options: {
                  description: "agent-edit-added",
                  isWholeLine: true,
                  className: "agent-edit-added-line",
                  linesDecorationsClassName: "agent-edit-added-gutter",
                },
              },
            ]
          : [],
      ),
    );
    editor.changeViewZones((accessor) => {
      for (const id of zoneIds) accessor.removeZone(id);
      zoneIds = items
        .filter((item) => item.removedLines.length > 0)
        .map((item) =>
          accessor.addZone({
            afterLineNumber: item.afterLineNumber,
            heightInLines: item.removedLines.length,
            domNode: removedLinesNode(editor, item.removedLines),
          }),
        );
    });
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(render, RENDER_DELAY_MS);
  };

  renderers.set(editor, schedule);
  const subscriptions = [
    editor.onDidChangeModel(() => {
      renderedKey = "";
      schedule();
    }),
    editor.onDidChangeModelContent(schedule),
    editor.onDidFocusEditorText(() => {
      focusedEditor = editor;
      syncKeymapContext();
    }),
  ];
  editor.onDidDispose(() => {
    clearTimeout(timer);
    renderers.delete(editor);
    for (const subscription of subscriptions) subscription.dispose();
    if (focusedEditor === editor) {
      focusedEditor = null;
      syncKeymapContext();
    }
  });
  render();
}

/**
 * The hunk under the cursor of the editor last focused, else the nearest one to it. Says so
 * when there is none, since the command palette can ask for one anywhere.
 */
function hunkAtCursor(): { editor: CodeEditor; lens: AgentEditLens } | null {
  const editor = focusedEditor;
  const lens =
    editor &&
    agentEditLensAtLine(lensesForModel(editor.getModel()), editor.getPosition()?.lineNumber ?? 1);
  if (!editor || !lens) {
    showToast({ type: "info", message: "No unreviewed agent change in this editor." });
    return null;
  }
  return { editor, lens };
}

/** Moves the cursor to the hunk nearest `line` once the review caught up, if one is left. */
function revealNextHunk(editor: CodeEditor, line: number) {
  const next = agentEditLensAtLine(lensesForModel(editor.getModel()), line);
  if (!next) return;
  editor.setPosition({ lineNumber: next.lineNumber, column: 1 });
  editor.revealLineInCenterIfOutsideViewport(next.lineNumber);
}

/** Keeps the agent hunk at the cursor of the focused editor; false when there is none. */
export async function keepAgentHunkAtCursor(): Promise<boolean> {
  const target = hunkAtCursor();
  if (!target) return false;
  const { editor, lens } = target;
  await keepAgentHunk(lens.chatId, lens.path, lens.hunk);
  revealNextHunk(editor, lens.lineNumber);
  return true;
}

/** Undoes the agent hunk at the cursor of the focused editor; false when there is none. */
export async function rejectAgentHunkAtCursor(): Promise<boolean> {
  const target = hunkAtCursor();
  if (!target) return false;
  const { editor, lens } = target;
  await rejectAgentHunk(lens.chatId, lens.path, lens.hunk);
  revealNextHunk(editor, lens.lineNumber);
  return true;
}

/**
 * Shows every unreviewed agent hunk in open editors: added lines in green, the lines they
 * replaced in red above them, and Keep and Undo code lenses doing what the chat's review does
 * for that hunk.
 */
export function registerAgentEditsCodeLens(): void {
  if (registered) return;
  registered = true;

  const changed = new Emitter<Monaco.languages.CodeLensProvider>();
  const provider: Monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses(model) {
      const found = lensesForModel(model);
      const chatCount = new Set(found.map((lens) => lens.chatId)).size;
      const lenses = found.flatMap((lens) => {
        const range = new MonacoRange(lens.lineNumber, 1, lens.lineNumber, 1);
        return [
          {
            range,
            command: {
              id: KEEP_COMMAND,
              title: actionTitle("Keep", lens, chatCount),
              tooltip: "Keep this agent change",
              arguments: [lens],
            },
          },
          {
            range,
            command: {
              id: REJECT_COMMAND,
              title: actionTitle("Undo", lens, chatCount),
              tooltip: "Undo this agent change",
              arguments: [lens],
            },
          },
        ];
      });
      return { lenses, dispose: () => {} };
    },
  };

  useAgentEditsStore.subscribe((state, previous) => {
    if (state.byChat === previous.byChat) return;
    changed.fire(provider);
    for (const schedule of renderers.values()) schedule();
  });
  monacoEditor.addCommand({
    id: KEEP_COMMAND,
    run: (_accessor, lens: AgentEditLens | undefined) => {
      if (lens) void keepAgentHunk(lens.chatId, lens.path, lens.hunk);
    },
  });
  monacoEditor.addCommand({
    id: REJECT_COMMAND,
    run: (_accessor, lens: AgentEditLens | undefined) => {
      if (lens) void rejectAgentHunk(lens.chatId, lens.path, lens.hunk);
    },
  });
  languages.registerCodeLensProvider("*", provider);
  monacoEditor.onDidCreateEditor(attachEditor);
  for (const editor of monacoEditor.getEditors()) attachEditor(editor);
}
