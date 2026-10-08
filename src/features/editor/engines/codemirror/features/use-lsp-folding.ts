import { LspClient } from "../../../lsp/lsp-client";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { lspFoldRegions, lspFolding, setLspFoldingRanges } from "../navigation/lsp-folding";
import { useDebouncedLspRefresh, useLspRevision } from "./lsp-feature-utils";

const REFRESH_DELAY_MS = 300;

/**
 * Folding ranges from the language server, on top of the language's syntax folding, refreshed
 * once edits pause.
 */
export function useLspFolding(host: CodeMirrorHost, enabled: boolean) {
  const { view, filePath } = host;
  const revision = useLspRevision();
  useCodeMirrorExtension(view, enabled ? lspFolding : null);

  useDebouncedLspRefresh(
    view,
    enabled,
    `${filePath}:${revision}`,
    REFRESH_DELAY_MS,
    (isCurrent) => {
      const client = LspClient.getInstance();
      if (!client.isDocumentOpen(filePath)) return;
      const doc = view.state.doc;
      void client.getFoldingRanges(filePath).then((ranges) => {
        if (!isCurrent() || view.state.doc !== doc) return;
        view.dispatch({ effects: setLspFoldingRanges.of(lspFoldRegions(doc, ranges)) });
      });
    },
  );
}
