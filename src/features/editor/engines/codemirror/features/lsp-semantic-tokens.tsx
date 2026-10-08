import {
  type ChangeSet,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { useMemo } from "react";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useLspStore } from "@/features/editor/lsp/stores/lsp.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { isLspFile } from "../lsp/lsp-positions";
import {
  type DecodedSemanticTokens,
  decodeSemanticTokens,
  forEachSemanticTokenRange,
} from "../lsp/semantic-token-styles";

/** How long typing has to pause before semantic tokens are requested again. */
const SEMANTIC_TOKEN_DEBOUNCE_MS = 300;
/** How long a failed request is not repeated for the same text. */
const SEMANTIC_TOKEN_RETRY_DELAY_MS = 15_000;
/** Lines decorated beyond each visible range, so ordinary scrolling reuses the built set. */
const SEMANTIC_TOKEN_MARGIN_LINES = 200;

const SYNTAX_NAMES = [
  "type",
  "variable",
  "property",
  "constant",
  "function",
  "comment",
  "string",
  "keyword",
  "number",
  "regex",
  "operator",
  "attribute",
  "boolean",
  "null",
];

/**
 * Semantic colors win over the syntax highlighter's whether their span ends up inside or around
 * it, so both the token and any highlighted span within it take the color.
 */
const semanticTokenTheme = EditorView.theme({
  ...Object.fromEntries(
    SYNTAX_NAMES.map((name) => [
      `.cm-athas-semantic-${name}, .cm-athas-semantic-${name} span`,
      { color: `var(--syntax-${name})` },
    ]),
  ),
  ".cm-athas-semantic-deprecated, .cm-athas-semantic-deprecated span": {
    textDecoration: "line-through",
  },
});

const semanticTokensUpdated = StateEffect.define<null>();

interface SemanticTokenClient {
  getActiveServerEntryForFile(filePath: string): unknown;
  getSemanticTokens: LspClient["getSemanticTokens"];
  isDocumentOpen(filePath: string): boolean;
}

export function semanticTokensExtension(
  filePath: string,
  client: SemanticTokenClient,
  debounceMs = SEMANTIC_TOKEN_DEBOUNCE_MS,
): Extension {
  const marks = new Map<string, Decoration>();
  const mark = (className: string) => {
    let decoration = marks.get(className);
    if (!decoration) {
      decoration = Decoration.mark({ class: className });
      marks.set(className, decoration);
    }
    return decoration;
  };

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private timer: ReturnType<typeof setTimeout> | null = null;
      private requestId = 0;
      private failed: { doc: Text; retryAfter: number } | null = null;
      private destroyed = false;
      private readonly unsubscribe: () => void;
      /** Decoded tokens of the last response and the text they describe. */
      private tokens: DecodedSemanticTokens | null = null;
      private tokenDoc: Text | null = null;
      /** Edits made since `tokenDoc`, so freshly built ranges land where mapped ones do. */
      private pendingChanges: ChangeSet | null = null;
      /** Current-document ranges the decoration set covers. */
      private covered: { from: number; to: number }[] = [];

      constructor(private readonly view: EditorView) {
        this.schedule(0);
        this.unsubscribe = useLspStore.subscribe((state, previous) => {
          if (
            state.lspStatus.status !== previous.lspStatus.status ||
            state.lspStatus.documentRevision !== previous.lspStatus.documentRevision
          ) {
            this.schedule(0);
          }
        });
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = this.decorations.map(update.changes);
          if (this.tokens) {
            this.pendingChanges = this.pendingChanges
              ? this.pendingChanges.compose(update.changes)
              : update.changes;
          }
          // Text typed at a covered edge has no tokens yet, so the coverage grows over it rather
          // than forcing a rebuild on every keystroke at the end of the window or document.
          this.covered = this.covered.map(({ from, to }) => ({
            from: update.changes.mapPos(from, -1),
            to: update.changes.mapPos(to, 1),
          }));
          this.schedule(debounceMs);
        }
        if ((update.docChanged || update.viewportChanged) && !this.coversVisibleRanges()) {
          this.buildVisible();
        }
      }

      private coversVisibleRanges() {
        if (!this.tokens) return true;
        return this.view.visibleRanges.every(({ from, to }) =>
          this.covered.some((range) => range.from <= from && range.to >= to),
        );
      }

      /** Rebuilds decorations for the visible ranges plus a margin from the cached tokens. */
      private buildVisible() {
        const { tokens, tokenDoc } = this;
        if (!tokens || !tokenDoc) return;
        const doc = this.view.state.doc;
        const toTokenDoc = this.pendingChanges?.invertedDesc;

        const windows: { from: number; to: number }[] = [];
        for (const range of this.view.visibleRanges) {
          const fromLine = Math.max(1, doc.lineAt(range.from).number - SEMANTIC_TOKEN_MARGIN_LINES);
          const toLine = Math.min(
            doc.lines,
            doc.lineAt(range.to).number + SEMANTIC_TOKEN_MARGIN_LINES,
          );
          const from = doc.line(fromLine).from;
          const to = doc.line(toLine).to;
          const last = windows[windows.length - 1];
          if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
          else windows.push({ from, to });
        }

        const builder = new RangeSetBuilder<Decoration>();
        let previousLine = -1;
        for (const window of windows) {
          const tokenFrom = toTokenDoc ? toTokenDoc.mapPos(window.from, -1) : window.from;
          const tokenTo = toTokenDoc ? toTokenDoc.mapPos(window.to, 1) : window.to;
          const fromLine = Math.max(previousLine + 1, tokenDoc.lineAt(tokenFrom).number - 1);
          const toLine = tokenDoc.lineAt(tokenTo).number - 1;
          if (fromLine > toLine) continue;
          forEachSemanticTokenRange(tokens, tokenDoc, fromLine, toLine, (from, to, className) =>
            builder.add(from, to, mark(className)),
          );
          previousLine = toLine;
        }
        const built = builder.finish();
        this.decorations = this.pendingChanges ? built.map(this.pendingChanges) : built;
        this.covered = windows;
      }

      private schedule(delay: number) {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.fetch();
        }, delay);
      }

      private async fetch() {
        if (
          this.destroyed ||
          !isLspFile(filePath) ||
          !client.getActiveServerEntryForFile(filePath) ||
          !client.isDocumentOpen(filePath)
        ) {
          return;
        }
        const { view } = this;
        const doc = view.state.doc;
        if (this.failed?.doc === doc && this.failed.retryAfter > Date.now()) return;

        const id = ++this.requestId;
        const response = await client.getSemanticTokens(filePath).catch(() => null);
        if (this.destroyed || id !== this.requestId || view.state.doc !== doc) return;
        if (!response) {
          this.failed = { doc, retryAfter: Date.now() + SEMANTIC_TOKEN_RETRY_DELAY_MS };
          return;
        }
        this.failed = null;

        this.tokens = decodeSemanticTokens(response);
        this.tokenDoc = doc;
        this.pendingChanges = null;
        this.buildVisible();
        view.dispatch({ effects: semanticTokensUpdated.of(null) });
      }

      destroy() {
        this.destroyed = true;
        if (this.timer !== null) clearTimeout(this.timer);
        this.unsubscribe();
      }
    },
    { decorations: (value) => value.decorations },
  );

  return [plugin, semanticTokenTheme];
}

/** Semantic token colors on the active, editable surface when the setting is on. */
export function LspSemanticTokens({ host }: { host: CodeMirrorHost }) {
  const { view, filePath, isActiveSurface, isReadOnly } = host;
  const semanticTokens = useSettingsStore((state) => state.settings.semanticTokens);
  const enabled = semanticTokens && isActiveSurface && !isReadOnly && Boolean(filePath);
  const extension = useMemo(
    () => (enabled ? semanticTokensExtension(filePath, LspClient.getInstance()) : null),
    [enabled, filePath],
  );
  useCodeMirrorExtension(view, extension);
  return null;
}
