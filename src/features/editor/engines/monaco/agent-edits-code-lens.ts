import { Emitter, Range as MonacoRange, editor as monacoEditor, languages } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { agentEditLenses, type AgentEditLens } from "@/features/ai/lib/agent-edit-lenses";
import { keepAgentHunk, rejectAgentHunk } from "@/features/ai/services/agent-edits-service";
import { useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { filePathFromUri } from "@/features/editor/lsp/workspace-edit";
import { filePathFromAthasModelUri } from "./model-uri";

const KEEP_COMMAND = "athas.keepAgentHunk";
const REJECT_COMMAND = "athas.rejectAgentHunk";

let registered = false;

function filePathFromModel(model: Monaco.editor.ITextModel): string | null {
  if (model.uri.scheme === "file") return filePathFromUri(model.uri.toString());
  if (model.uri.scheme === "athas") {
    return filePathFromAthasModelUri(model.uri.path, model.uri.query);
  }
  return null;
}

/** Names the chat on its actions when more than one chat's agent edited the file. */
function actionTitle(action: string, lens: AgentEditLens, chatCount: number): string {
  if (chatCount < 2) return action;
  const title = useAIChatStore.getState().chats.find((chat) => chat.id === lens.chatId)?.title;
  return title ? `${action} (${title})` : action;
}

/**
 * Offers Keep and Reject above every unreviewed agent hunk in an open editor, as code lenses,
 * doing what the chat's review does for that hunk.
 */
export function registerAgentEditsCodeLens(): void {
  if (registered) return;
  registered = true;

  const changed = new Emitter<Monaco.languages.CodeLensProvider>();
  const provider: Monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses(model) {
      const path = filePathFromModel(model);
      if (!path) return { lenses: [], dispose: () => {} };
      const found = agentEditLenses(useAgentEditsStore.getState().byChat, path, model.getValue());
      const chatCount = new Set(found.map((lens) => lens.chatId)).size;
      const lenses = found.flatMap((lens) => {
        const range = new MonacoRange(lens.lineNumber, 1, lens.lineNumber, 1);
        return [
          {
            range,
            command: {
              id: KEEP_COMMAND,
              title: actionTitle("Keep", lens, chatCount),
              arguments: [lens],
            },
          },
          {
            range,
            command: {
              id: REJECT_COMMAND,
              title: actionTitle("Reject", lens, chatCount),
              arguments: [lens],
            },
          },
        ];
      });
      return { lenses, dispose: () => {} };
    },
  };

  useAgentEditsStore.subscribe((state, previous) => {
    if (state.byChat !== previous.byChat) changed.fire(provider);
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
}
