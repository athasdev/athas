import { type Extension, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { useMemo } from "react";
import type { DocumentHighlight } from "vscode-languageserver-protocol";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { fromLspRange, isLspFile, toLspPosition } from "../lsp/lsp-positions";

/** How long the cursor rests before occurrences are requested, as in Monaco. */
const DOCUMENT_HIGHLIGHT_DELAY_MS = 250;

const highlightMarks = {
  text: Decoration.mark({ class: "cm-athas-documentHighlight" }),
  read: Decoration.mark({ class: "cm-athas-documentHighlight cm-athas-documentHighlight-read" }),
  write: Decoration.mark({
    class: "cm-athas-documentHighlight cm-athas-documentHighlight-write",
  }),
};

const documentHighlightTheme = EditorView.theme({
  ".cm-athas-documentHighlight": { backgroundColor: "var(--selected)" },
  ".cm-athas-documentHighlight-write": {
    backgroundColor: "var(--selected)",
    boxShadow: "inset 0 -1px 0 var(--border-strong)",
  },
});

const documentHighlightsUpdated = StateEffect.define<null>();

interface DocumentHighlightClient {
  getDocumentHighlights(
    filePath: string,
    line: number,
    character: number,
  ): Promise<DocumentHighlight[]>;
}

export function documentHighlightExtension(
  filePath: string,
  client: DocumentHighlightClient,
  delayMs = DOCUMENT_HIGHLIGHT_DELAY_MS,
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private timer: ReturnType<typeof setTimeout> | null = null;
      private requestId = 0;
      private destroyed = false;

      constructor(private readonly view: EditorView) {
        this.schedule();
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = this.decorations.map(update.changes);
        }
        if (update.docChanged || update.selectionSet) this.schedule();
      }

      private schedule() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.requestId += 1;
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.fetch();
        }, delayMs);
      }

      private clear() {
        if (this.decorations.size === 0) return;
        this.decorations = Decoration.none;
        this.view.dispatch({ effects: documentHighlightsUpdated.of(null) });
      }

      private async fetch() {
        const { view } = this;
        const { state } = view;
        const main = state.selection.main;
        if (
          !isLspFile(filePath) ||
          state.selection.ranges.length > 1 ||
          state.doc.lineAt(main.from).number !== state.doc.lineAt(main.to).number
        ) {
          this.clear();
          return;
        }
        const id = ++this.requestId;
        const position = toLspPosition(state.doc, main.head);
        const highlights = await client
          .getDocumentHighlights(filePath, position.line, position.character)
          .catch(() => []);
        if (
          this.destroyed ||
          id !== this.requestId ||
          view.state.doc !== state.doc ||
          !view.state.selection.main.eq(main)
        ) {
          return;
        }
        if (highlights.length === 0) {
          this.clear();
          return;
        }
        const ranges = highlights
          .map((highlight) => {
            const range = fromLspRange(state.doc, highlight.range);
            const mark =
              highlight.kind === 3
                ? highlightMarks.write
                : highlight.kind === 2
                  ? highlightMarks.read
                  : highlightMarks.text;
            return range.from < range.to ? mark.range(range.from, range.to) : null;
          })
          .filter((range) => range !== null);
        this.decorations = Decoration.set(ranges, true);
        view.dispatch({ effects: documentHighlightsUpdated.of(null) });
      }

      destroy() {
        this.destroyed = true;
        if (this.timer !== null) clearTimeout(this.timer);
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [plugin, documentHighlightTheme];
}

/** Occurrences of the symbol under the cursor, from the language server. */
export function LspDocumentHighlight({ host }: { host: CodeMirrorHost }) {
  const { view, filePath, isActiveSurface } = host;
  const highlightOccurrences = useSettingsStore((state) => state.settings.highlightOccurrences);
  const enabled = highlightOccurrences && isActiveSurface && Boolean(filePath);
  const extension = useMemo(
    () => (enabled ? documentHighlightExtension(filePath, LspClient.getInstance()) : null),
    [enabled, filePath],
  );
  useCodeMirrorExtension(view, extension);
  return null;
}
