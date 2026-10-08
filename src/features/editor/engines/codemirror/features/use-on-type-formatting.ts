import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useMemo } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { LspClient } from "../../../lsp/services/lsp-client";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { lspTextEditsToChanges, toLspPosition } from "../navigation/lsp-document";
import { onTypeFormattingTrigger } from "../navigation/on-type-formatting";

const triggerCharacters = new Map<string, Promise<string[]>>();

function serverTriggerCharacters(filePath: string) {
  let characters = triggerCharacters.get(filePath);
  if (!characters) {
    characters = LspClient.getInstance().getOnTypeFormattingTriggerCharacters(filePath);
    triggerCharacters.set(filePath, characters);
    void characters.then((list) => {
      if (list.length === 0) triggerCharacters.delete(filePath);
    });
  }
  return characters;
}

/**
 * Formats as you type `;`, `}` or a line break when the server supports on-type formatting for
 * that character, applying the server's edits as one change the buffer then picks up. Monaco
 * kept this behind its `formatOnType` option, so it stays behind a `formatOnType` setting.
 */
export function useOnTypeFormatting(host: CodeMirrorHost, lspEnabled: boolean) {
  const { filePath } = host;
  const setting = useSettingsStore(
    (state) => "formatOnType" in state.settings && state.settings.formatOnType === true,
  );
  const enabled = lspEnabled && setting && !host.isReadOnly;

  const extension = useMemo(
    () =>
      enabled
        ? EditorView.updateListener.of((update) => {
            for (const tr of update.transactions) {
              const trigger = onTypeFormattingTrigger(tr);
              if (!trigger) continue;
              const view = update.view;
              const doc = update.state.doc;
              const { line, character } = toLspPosition(doc, trigger.position);
              const tabSize = update.state.facet(EditorState.tabSize);
              void serverTriggerCharacters(filePath)
                .then((characters) =>
                  characters.includes(trigger.character)
                    ? LspClient.getInstance().formatOnType(
                        filePath,
                        line,
                        character,
                        trigger.character,
                        tabSize,
                        true,
                      )
                    : [],
                )
                .then((edits) => {
                  if (edits.length === 0 || view.state.doc !== doc) return;
                  view.dispatch({
                    changes: lspTextEditsToChanges(doc, edits),
                    userEvent: "input.format",
                  });
                });
            }
          })
        : null,
    [enabled, filePath],
  );
  useCodeMirrorExtension(host.view, extension);
}
