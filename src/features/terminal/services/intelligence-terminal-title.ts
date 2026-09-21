import { requestInlineEdit } from "@/features/ai/intelligence/services/intelligence-text-service";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useTerminalTabsStore } from "../stores/terminal-tabs.store";
import { useTerminalStore } from "../stores/terminal.store";
import { normalizeTerminalTitle } from "../utils/terminal-title";

export async function renameTerminalWithIntelligence(terminalId?: string) {
  const state = useTerminalTabsStore.getState();
  const id = terminalId ?? state.activeTerminalId;
  const terminal = state.terminals.find((item) => item.id === id);
  if (!terminal) throw new Error("Select a terminal first.");
  const workspace = useProjectStore.getState().rootFolderPath;
  const { editedText } = await requestInlineEdit(
    {
      feature: "terminal-title",
      model: "",
      beforeSelection: "",
      selectedText: JSON.stringify({
        title: terminal.title?.slice(0, 512),
        name: terminal.name.slice(0, 100),
        directory: terminal.currentDirectory
          .replace(/[/\\]+$/, "")
          .split(/[/\\]/)
          .pop(),
      }),
      instruction:
        "Name this terminal task in two to four words, at most 48 characters. Return only the title without quotes.",
    },
    { signal: AbortSignal.timeout(15000) },
  );
  const current = useTerminalTabsStore.getState().terminals.find((item) => item.id === id);
  if (
    useProjectStore.getState().rootFolderPath !== workspace ||
    !current ||
    current.name !== terminal.name ||
    current.customName !== terminal.customName
  )
    return false;
  const name = normalizeTerminalTitle(editedText.trim().replace(/^["']|["']$/g, ""));
  if (!name || name.length > 48)
    throw new Error("The model did not return a short terminal title.");
  useTerminalTabsStore
    .getState()
    .actions.dispatch({ type: "UPDATE_TERMINAL_NAME", payload: { id: terminal.id, name } });
  useTerminalStore.getState().actions.updateSession(terminal.id, { name, customName: true });
  const { buffers, actions } = useBufferStore.getState();
  for (const buffer of buffers) {
    if (buffer.type === "terminal" && buffer.sessionId === terminal.id)
      actions.updateBuffer({ ...buffer, name });
  }
  return true;
}
