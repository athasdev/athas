import { type Extension, Prec, StateEffect, StateField, Transaction } from "@codemirror/state";
import {
  type EditorView,
  keymap,
  showTooltip,
  type Tooltip,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { useMemo } from "react";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { isLspFile, toLspPosition } from "../lsp/lsp-positions";
import { createDocumentationElement } from "../lsp/markdown-content";

export type SignatureHelp = NonNullable<Awaited<ReturnType<LspClient["getSignatureHelp"]>>>;

interface SignatureHelpState {
  pos: number;
  help: SignatureHelp;
  activeSignature: number;
}

const DEFAULT_TRIGGER_CHARACTERS = ["(", ","];
const REFRESH_DELAY_MS = 100;

const setSignatureHelp = StateEffect.define<SignatureHelpState | null>();

const signatureHelpField = StateField.define<SignatureHelpState | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setSignatureHelp)) return effect.value;
    if (value && tr.docChanged) return { ...value, pos: tr.changes.mapPos(value.pos) };
    return value;
  },
  provide: (field) =>
    showTooltip.from(field, (value): Tooltip | null =>
      value
        ? {
            pos: value.pos,
            above: true,
            create: () => ({ dom: renderSignatureHelp(value.help, value.activeSignature) }),
          }
        : null,
    ),
});

/** Splits a signature label around its active parameter. */
export function splitSignatureLabel(
  label: string,
  parameter: SignatureHelp["signatures"][number]["parameters"],
  activeParameter: number,
): [string, string, string] {
  const active = parameter?.[activeParameter];
  if (!active) return [label, "", ""];
  let start: number;
  let end: number;
  if (Array.isArray(active.label)) {
    [start, end] = active.label;
  } else {
    start = label.indexOf(active.label);
    end = start + active.label.length;
  }
  if (start < 0 || end > label.length || start >= end) return [label, "", ""];
  return [label.slice(0, start), label.slice(start, end), label.slice(end)];
}

/** The parameter hint card: the signature with its active parameter, then the docs. */
export function renderSignatureHelp(help: SignatureHelp, activeSignature: number) {
  const element = document.createElement("div");
  element.className = "cm-athas-signatureHelp";
  const signature = help.signatures[activeSignature] ?? help.signatures[0];
  if (!signature) return element;
  const activeParameter = signature.activeParameter ?? help.activeParameter ?? 0;

  const row = document.createElement("div");
  row.className = "cm-athas-signatureRow";
  if (help.signatures.length > 1) {
    const count = document.createElement("span");
    count.className = "cm-athas-signatureCount";
    count.textContent = `${activeSignature + 1}/${help.signatures.length}`;
    row.append(count);
  }
  const label = document.createElement("span");
  label.className = "cm-athas-signatureLabel";
  const [before, active, after] = splitSignatureLabel(
    signature.label,
    signature.parameters,
    activeParameter,
  );
  label.append(before);
  if (active) {
    const parameter = document.createElement("span");
    parameter.className = "cm-athas-signatureActiveParameter";
    parameter.textContent = active;
    label.append(parameter);
  }
  label.append(after);
  row.append(label);
  element.append(row);

  const parameterDocs = createDocumentationElement(
    signature.parameters?.[activeParameter]?.documentation,
    "cm-athas-signatureDocs",
  );
  const signatureDocs = createDocumentationElement(
    signature.documentation,
    "cm-athas-signatureDocs",
  );
  if (parameterDocs) element.append(parameterDocs);
  if (signatureDocs) element.append(signatureDocs);
  return element;
}

/** The single character typed by a transaction, used to spot trigger characters. */
function typedCharacter(update: ViewUpdate): string | null {
  let typed: string | null = null;
  for (const tr of update.transactions) {
    if (!tr.isUserEvent("input.type")) continue;
    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      const text = inserted.toString();
      if (text) typed = text[text.length - 1];
    });
  }
  return typed;
}

function cycleSignature(view: EditorView, step: number) {
  const value = view.state.field(signatureHelpField, false);
  if (!value || value.help.signatures.length < 2) return false;
  const count = value.help.signatures.length;
  view.dispatch({
    effects: setSignatureHelp.of({
      ...value,
      activeSignature: (value.activeSignature + step + count) % count,
    }),
  });
  return true;
}

interface SignatureHelpClient {
  getSignatureHelp: LspClient["getSignatureHelp"];
  getSignatureTriggerCharacters: LspClient["getSignatureTriggerCharacters"];
}

export function signatureHelpExtension(
  filePath: string,
  client: SignatureHelpClient,
  isActiveSurface: boolean,
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private requestId = 0;
      private triggerCharacters = new Set(DEFAULT_TRIGGER_CHARACTERS);
      private destroyed = false;

      constructor(private readonly view: EditorView) {
        void client
          .getSignatureTriggerCharacters(filePath)
          .then((characters) => {
            if (characters.length > 0) this.triggerCharacters = new Set(characters);
          })
          .catch(() => {});
        window.addEventListener("editor-trigger-signature-help", this.handleTrigger);
      }

      private readonly handleTrigger = () => {
        if (isActiveSurface) this.schedule(0);
      };

      update(update: ViewUpdate) {
        const active = update.state.field(signatureHelpField, false) !== null;
        if (update.docChanged) {
          const typed = typedCharacter(update);
          if (typed && this.triggerCharacters.has(typed)) this.schedule(0);
          else if (active) this.schedule(REFRESH_DELAY_MS);
        } else if (update.selectionSet && active) {
          this.schedule(REFRESH_DELAY_MS);
        }
        if (update.focusChanged && !update.view.hasFocus && active) {
          this.cancel();
          queueMicrotask(() => {
            if (!this.destroyed) this.view.dispatch({ effects: setSignatureHelp.of(null) });
          });
        }
      }

      private cancel() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.requestId += 1;
      }

      private schedule(delay: number) {
        this.cancel();
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.fetch();
        }, delay);
      }

      private async fetch() {
        const id = ++this.requestId;
        const { view } = this;
        if (!isLspFile(filePath)) return;
        const doc = view.state.doc;
        const head = view.state.selection.main.head;
        const position = toLspPosition(doc, head);
        const help = await client
          .getSignatureHelp(filePath, position.line, position.character)
          .catch(() => null);
        if (this.destroyed || id !== this.requestId || view.state.doc !== doc) return;
        const previous = view.state.field(signatureHelpField, false);
        if (!help || help.signatures.length === 0) {
          if (previous) view.dispatch({ effects: setSignatureHelp.of(null) });
          return;
        }
        const keepSelection =
          previous && previous.help.signatures.length === help.signatures.length;
        const activeSignature = keepSelection
          ? previous.activeSignature
          : Math.min(help.activeSignature ?? 0, help.signatures.length - 1);
        view.dispatch({
          effects: setSignatureHelp.of({ pos: head, help, activeSignature }),
          annotations: Transaction.addToHistory.of(false),
        });
      }

      destroy() {
        this.destroyed = true;
        this.cancel();
        window.removeEventListener("editor-trigger-signature-help", this.handleTrigger);
      }
    },
  );

  return [
    signatureHelpField,
    plugin,
    Prec.high(
      keymap.of([
        {
          key: "Escape",
          run: (view) => {
            if (!view.state.field(signatureHelpField, false)) return false;
            view.dispatch({ effects: setSignatureHelp.of(null) });
            return true;
          },
        },
        { key: "ArrowUp", run: (view) => cycleSignature(view, -1) },
        { key: "ArrowDown", run: (view) => cycleSignature(view, 1) },
        { key: "Alt-ArrowUp", run: (view) => cycleSignature(view, -1) },
        { key: "Alt-ArrowDown", run: (view) => cycleSignature(view, 1) },
      ]),
    ),
  ];
}

/** Parameter hints from the language server, opened by trigger characters or the command. */
export function LspSignatureHelp({ host }: { host: CodeMirrorHost }) {
  const { view, filePath, isActiveSurface, isReadOnly } = host;
  const parameterHints = useSettingsStore((state) => state.settings.parameterHints);
  const enabled = parameterHints && !isReadOnly && Boolean(filePath);
  const extension = useMemo(
    () =>
      enabled ? signatureHelpExtension(filePath, LspClient.getInstance(), isActiveSurface) : null,
    [enabled, filePath, isActiveSurface],
  );
  useCodeMirrorExtension(view, extension);

  return null;
}
