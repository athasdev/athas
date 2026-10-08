import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { LspClient } from "../../../lsp/services/lsp-client";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import {
  codeLensDecorations,
  codeLensField,
  type LspCodeLens,
  parseShowReferencesArguments,
  SHOW_REFERENCES_COMMAND,
  setCodeLenses,
} from "../navigation/code-lens";
import { fromLspPosition } from "../navigation/lsp-document";
import { useDebouncedLspRefresh, useLspRevision } from "./lsp-feature-utils";
import type { OpenReferencesPeek } from "./use-references-peek";

const REFRESH_DELAY_MS = 250;

/**
 * LSP code lenses drawn as rows above their lines, when the `codeLens` setting is on, refreshed
 * once edits pause. A "references" lens opens the inline references peek; any other runs its
 * command on the server.
 */
export function useLspCodeLens(
  host: CodeMirrorHost,
  lspEnabled: boolean,
  openPeek: OpenReferencesPeek,
) {
  const { view, filePath } = host;
  const setting = useSettingsStore((state) => state.settings.codeLens);
  const enabled = lspEnabled && setting;
  const revision = useLspRevision();
  const openPeekRef = useRef(openPeek);
  openPeekRef.current = openPeek;
  useCodeMirrorExtension(view, enabled ? codeLensField : null);

  const run = useCallback(
    (lens: LspCodeLens, lensView: EditorView) => {
      if (!lens.command) return;
      if (lens.command === SHOW_REFERENCES_COMMAND) {
        const references = parseShowReferencesArguments(lens.arguments);
        if (references) {
          openPeekRef.current(
            fromLspPosition(lensView.state.doc, references.position),
            references.locations,
          );
          return;
        }
      }
      void LspClient.getInstance()
        .applyCodeAction(filePath, {
          title: lens.title,
          command: lens.command,
          arguments: lens.arguments ?? [],
        })
        .then((result) => {
          if (!result.applied) toast.error(result.reason || `Failed to run ${lens.title}`);
        });
    },
    [filePath],
  );

  useDebouncedLspRefresh(
    view,
    enabled,
    `${filePath}:${revision}`,
    REFRESH_DELAY_MS,
    (isCurrent) => {
      const client = LspClient.getInstance();
      if (!client.getActiveServerEntryForFile(filePath) || !client.isDocumentOpen(filePath)) return;
      const doc = view.state.doc;
      void client.getCodeLens(filePath).then((lenses) => {
        if (!isCurrent() || view.state.doc !== doc) return;
        const tabSize = view.state.facet(EditorState.tabSize);
        view.dispatch({
          effects: setCodeLenses.of(codeLensDecorations(doc, lenses, tabSize, run)),
        });
      });
    },
  );
}
