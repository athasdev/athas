import { type Extension, RangeSetBuilder, StateEffect, type Text } from "@codemirror/state";
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
import { semanticTokenRanges } from "../lsp/semantic-token-styles";

/** How long typing has to pause before semantic tokens are requested again. */
const SEMANTIC_TOKEN_DEBOUNCE_MS = 300;
/** How long a failed request is not repeated for the same text. */
const SEMANTIC_TOKEN_RETRY_DELAY_MS = 15_000;

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
        if (!update.docChanged) return;
        this.decorations = this.decorations.map(update.changes);
        this.schedule(debounceMs);
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

        const builder = new RangeSetBuilder<Decoration>();
        if (response.tokenTypes.length > 0) {
          for (const range of semanticTokenRanges(response, doc)) {
            builder.add(range.from, range.to, mark(range.className));
          }
        }
        this.decorations = builder.finish();
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
