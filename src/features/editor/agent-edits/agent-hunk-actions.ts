import { agentEditLensAtLine } from "@/features/ai/lib/agent-edit-decorations";
import { agentEditLenses, type AgentEditLens } from "@/features/ai/lib/agent-edit-lenses";
import { keepAgentHunk, rejectAgentHunk } from "@/features/ai/services/agent-edits-service";
import { useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useKeymapStore } from "@/features/keymaps/stores/keymaps.store";
import { showToast } from "@/utils/toast";

/** Keymap context: the focused editor shows unreviewed agent hunks. */
export const AGENT_EDIT_HUNKS_CONTEXT = "agentEditHunks";

/**
 * An editor that shows agent hunks, as the hunk commands see it. Whichever editor engine draws
 * the hunks registers one, so the commands work without knowing the engine.
 */
export interface AgentHunkEditor {
  /** The file the editor shows, or null when it shows none. */
  getFilePath: () => string | null;
  /** The editor's text, with the buffer's own line separators. */
  getText: () => string;
  /** The 1-based line of the cursor. */
  getCursorLine: () => number;
  /** Moves the cursor to the start of a 1-based line and scrolls it into view if needed. */
  revealLine: (line: number) => void;
}

const hunkCounts = new Map<AgentHunkEditor, number>();
let focusedEditor: AgentHunkEditor | null = null;

function syncKeymapContext() {
  const hasHunks = !!focusedEditor && (hunkCounts.get(focusedEditor) ?? 0) > 0;
  useKeymapStore.getState().actions.setContext(AGENT_EDIT_HUNKS_CONTEXT, hasHunks);
}

/** The unreviewed agent hunks for a file shown with `getText`'s text. */
export function agentEditLensesFor(filePath: string | null, getText: () => string) {
  if (!filePath) return [];
  const { byChat } = useAgentEditsStore.getState();
  // Reading the editor's text is the costly part; skip it for files no agent edited.
  if (!Object.values(byChat).some((entries) => entries[filePath])) return [];
  return agentEditLenses(byChat, filePath, getText());
}

/** Names the chat on its actions when more than one chat's agent edited the file. */
export function agentHunkActionTitle(action: string, lens: AgentEditLens, chatCount: number) {
  if (chatCount < 2) return action;
  const title = useAIChatStore.getState().chats.find((chat) => chat.id === lens.chatId)?.title;
  return title ? `${action} (${title})` : action;
}

/** Records how many hunks an editor shows, for the keymap context of the focused one. */
export function setAgentHunkCount(editor: AgentHunkEditor, count: number) {
  hunkCounts.set(editor, count);
  if (editor === focusedEditor) syncKeymapContext();
}

/** Makes `editor` the one the hunk commands act on, until another takes focus. */
export function focusAgentHunkEditor(editor: AgentHunkEditor) {
  focusedEditor = editor;
  syncKeymapContext();
}

/** Forgets an editor that went away. */
export function removeAgentHunkEditor(editor: AgentHunkEditor) {
  hunkCounts.delete(editor);
  if (focusedEditor !== editor) return;
  focusedEditor = null;
  syncKeymapContext();
}

/**
 * The hunk under the cursor of the editor last focused, else the nearest one to it. Says so
 * when there is none, since the command palette can ask for one anywhere.
 */
function hunkAtCursor(): { editor: AgentHunkEditor; lens: AgentEditLens } | null {
  const editor = focusedEditor;
  const lens =
    editor &&
    agentEditLensAtLine(
      agentEditLensesFor(editor.getFilePath(), editor.getText),
      editor.getCursorLine(),
    );
  if (!editor || !lens) {
    showToast({ type: "info", message: "No unreviewed agent change in this editor." });
    return null;
  }
  return { editor, lens };
}

/** Moves the cursor to the hunk nearest `line` once the review caught up, if one is left. */
function revealNextHunk(editor: AgentHunkEditor, line: number) {
  const next = agentEditLensAtLine(agentEditLensesFor(editor.getFilePath(), editor.getText), line);
  if (next) editor.revealLine(next.lineNumber);
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
