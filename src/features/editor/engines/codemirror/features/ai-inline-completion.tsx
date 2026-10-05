import { completionStatus } from "@codemirror/autocomplete";
import {
  EditorSelection,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import { recordRecentEdit } from "@/features/editor/intelligence-completion/intelligence-completion-context";
import {
  canRequestIntelligenceCompletion,
  INTELLIGENCE_COMPLETION_DEBOUNCE_MS,
  INTELLIGENCE_COMPLETION_PREFIX_CHARS,
  INTELLIGENCE_COMPLETION_SUFFIX_CHARS,
  type IntelligenceCompletionRequest,
  registerIntelligenceCompletionResume,
  requestIntelligenceCompletion,
} from "@/features/editor/intelligence-completion/intelligence-completion-service";
import type { LineSeparator } from "../document-change";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";

export interface InlineSuggestion {
  pos: number;
  text: string;
}

const ACCEPT_EVENT = "input.complete.inline";

export const setInlineSuggestion = StateEffect.define<InlineSuggestion | null>();

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: GhostTextWidget) {
    return other.text === this.text;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-athas-ghostText";
    element.textContent = this.text;
    return element;
  }
}

/**
 * The suggestion shown as ghost text. Typing the text it starts with keeps the rest showing;
 * any other edit, or moving the cursor away, drops it.
 */
export const inlineSuggestionField = StateField.define<InlineSuggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setInlineSuggestion)) return effect.value;
    if (!value) return null;
    if (tr.docChanged) {
      const inserts: Array<{ from: number; to: number; text: string }> = [];
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        inserts.push({ from: fromA, to: toA, text: inserted.toString() });
      });
      const [typed] = inserts;
      if (
        inserts.length !== 1 ||
        typed.from !== value.pos ||
        typed.to !== value.pos ||
        !typed.text ||
        !value.text.startsWith(typed.text)
      ) {
        return null;
      }
      const rest = value.text.slice(typed.text.length);
      const pos = value.pos + typed.text.length;
      const head = tr.state.selection.main;
      if (!rest || !head.empty || head.head !== pos) return null;
      return { pos, text: rest };
    }
    if (tr.selection) {
      const head = tr.state.selection.main;
      if (!head.empty || head.head !== value.pos) return null;
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) =>
      value
        ? Decoration.set([
            Decoration.widget({ widget: new GhostTextWidget(value.text), side: 1 }).range(
              value.pos,
            ),
          ])
        : Decoration.none,
    ),
});

function acceptText(view: EditorView, text: string) {
  const suggestion = view.state.field(inlineSuggestionField, false);
  if (!suggestion || !text) return false;
  const end = suggestion.pos + text.length;
  view.dispatch({
    changes: { from: suggestion.pos, insert: text },
    selection: EditorSelection.cursor(end),
    scrollIntoView: true,
    annotations: Transaction.userEvent.of(ACCEPT_EVENT),
  });
  return true;
}

/** The next word of a suggestion, with the whitespace before it, as Monaco accepted it. */
export function nextSuggestionWord(text: string) {
  const match = /^(\s*[\p{L}\p{N}_$]+|\s*[^\s\p{L}\p{N}_$]+|\s+)/u.exec(text);
  return match ? match[0] : text;
}

export function acceptInlineSuggestion(view: EditorView) {
  if (completionStatus(view.state) === "active") return false;
  const suggestion = view.state.field(inlineSuggestionField, false);
  return suggestion ? acceptText(view, suggestion.text) : false;
}

export function acceptInlineSuggestionWord(view: EditorView) {
  const suggestion = view.state.field(inlineSuggestionField, false);
  return suggestion ? acceptText(view, nextSuggestionWord(suggestion.text)) : false;
}

export function dismissInlineSuggestion(view: EditorView) {
  if (!view.state.field(inlineSuggestionField, false)) return false;
  view.dispatch({ effects: setInlineSuggestion.of(null) });
  return true;
}

export interface InlineCompletionOptions {
  filePath: string;
  languageId: string;
  getSeparator: () => LineSeparator;
  request?: (request: IntelligenceCompletionRequest) => Promise<string | null>;
  debounceMs?: number;
}

/** Ghost text completions from the AI model: Tab accepts, Escape dismisses. */
export function inlineCompletionExtension(options: InlineCompletionOptions): Extension {
  const request = options.request ?? requestIntelligenceCompletion;
  const debounceMs = options.debounceMs ?? INTELLIGENCE_COMPLETION_DEBOUNCE_MS;

  const plugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private controller: AbortController | null = null;
      private destroyed = false;

      constructor(private readonly view: EditorView) {}

      update(update: ViewUpdate) {
        const suggestion = update.state.field(inlineSuggestionField, false);
        if (update.docChanged) {
          this.cancel();
          const typed = update.transactions.some(
            (tr) =>
              (tr.isUserEvent("input") || tr.isUserEvent("delete")) &&
              !tr.isUserEvent(ACCEPT_EVENT),
          );
          if (typed && !suggestion) this.schedule(debounceMs);
        } else if (update.selectionSet) {
          this.cancel();
        }
        if (suggestion && completionStatus(update.state) === "active") this.clearSoon();
        if (update.focusChanged && !update.view.hasFocus) {
          this.cancel();
          if (suggestion) this.clearSoon();
        }
      }

      private clearSoon() {
        queueMicrotask(() => {
          if (!this.destroyed) dismissInlineSuggestion(this.view);
        });
      }

      cancel() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.controller?.abort();
        this.controller = null;
      }

      schedule(delay: number) {
        this.cancel();
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.request();
        }, delay);
      }

      private async request() {
        const { view } = this;
        const { state } = view;
        const main = state.selection.main;
        if (
          !view.hasFocus ||
          state.readOnly ||
          !main.empty ||
          state.selection.ranges.length > 1 ||
          completionStatus(state) !== null ||
          !canRequestIntelligenceCompletion(options.filePath)
        ) {
          return;
        }
        const separator = options.getSeparator();
        const pos = main.head;
        const doc = state.doc;
        const beforeSelection = doc.sliceString(
          Math.max(0, pos - INTELLIGENCE_COMPLETION_PREFIX_CHARS),
          pos,
          separator,
        );
        if (!beforeSelection.trim()) return;
        const afterSelection = doc.sliceString(
          pos,
          Math.min(doc.length, pos + INTELLIGENCE_COMPLETION_SUFFIX_CHARS),
          separator,
        );
        const controller = new AbortController();
        this.controller = controller;
        const text = await request({
          filePath: options.filePath,
          languageId: options.languageId,
          beforeSelection,
          afterSelection,
          line: doc.lineAt(pos).number,
          signal: controller.signal,
        });
        if (this.controller === controller) this.controller = null;
        if (
          !text ||
          this.destroyed ||
          controller.signal.aborted ||
          view.state.doc !== doc ||
          view.state.selection.main.head !== pos ||
          !view.state.selection.main.empty ||
          completionStatus(view.state) !== null
        ) {
          return;
        }
        view.dispatch({
          effects: setInlineSuggestion.of({ pos, text: text.replace(/\r\n/g, "\n") }),
        });
      }

      destroy() {
        this.destroyed = true;
        this.cancel();
      }
    },
  );

  return [
    inlineSuggestionField,
    plugin,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptInlineSuggestion },
        { key: "Escape", run: dismissInlineSuggestion },
        { key: "Mod-ArrowRight", run: acceptInlineSuggestionWord },
        {
          key: "Alt-\\",
          run: (view) => {
            const instance = view.plugin(plugin);
            if (!instance) return false;
            instance.schedule(0);
            return true;
          },
        },
      ]),
    ),
  ];
}

/** Feeds edits to the recent-edit context Tab autocomplete sends along with its requests. */
function recentEditTracker(filePath: string): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    for (const tr of update.transactions) {
      if (!tr.docChanged || tr.annotation(Transaction.userEvent) === undefined) continue;
      let lastFrom = -1;
      let lastText = "";
      tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
        lastFrom = fromB;
        lastText = inserted.toString();
      });
      if (lastFrom < 0) continue;
      const doc = tr.state.doc;
      recordRecentEdit(
        filePath,
        { lineCount: doc.lines, lineText: (line) => doc.line(line).text },
        doc.lineAt(lastFrom).number,
        lastText,
      );
    }
  });
}

/** AI ghost text completions on the active, editable surface. */
export function AiInlineCompletion({ host }: { host: CodeMirrorHost }) {
  const { view, filePath, languageId, isActiveSurface, isReadOnly, getSeparator } = host;

  const separatorRef = useRef(getSeparator);
  separatorRef.current = getSeparator;

  useEffect(() => registerIntelligenceCompletionResume(), []);

  const tracker = useMemo(() => (filePath ? recentEditTracker(filePath) : null), [filePath]);
  useCodeMirrorExtension(view, tracker);

  const extension = useMemo(
    () =>
      isActiveSurface && !isReadOnly && filePath
        ? inlineCompletionExtension({
            filePath,
            languageId: languageId ?? "plaintext",
            getSeparator: () => separatorRef.current(),
          })
        : null,
    [filePath, isActiveSurface, isReadOnly, languageId],
  );
  useCodeMirrorExtension(view, extension);
  return null;
}
