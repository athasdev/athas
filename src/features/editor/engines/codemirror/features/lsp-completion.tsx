import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  startCompletion,
} from "@codemirror/autocomplete";
import { Prec, type Extension } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { useEffect, useMemo } from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import {
  applyLspCompletion,
  COMPLETION_TRIGGER_CHARACTERS,
  COMPLETION_WORD,
  COMPLETION_WORD_BEFORE,
  type CompletionRequest,
  getLspCompletionEntry,
  isDeprecatedCompletion,
  type LspCompletionEntry,
  toCodeMirrorCompletion,
  wordCompletions,
} from "../lsp/lsp-completion-items";
import { isLspFile, toLspPosition } from "../lsp/lsp-positions";
import type { SnippetVariableResolver } from "../lsp/lsp-snippet";
import { createDocumentationElement } from "../lsp/markdown-content";
import { emitAppEvent, onAppEvent } from "@/utils/app-events";

function pathParts(filePath: string) {
  const separator = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = filePath.slice(separator + 1);
  const dot = name.lastIndexOf(".");
  return {
    directory: separator >= 0 ? filePath.slice(0, separator) : "",
    name,
    base: dot > 0 ? name.slice(0, dot) : name,
  };
}

/** Values for the LSP snippet variables a server may use, read when the snippet is inserted. */
export function snippetVariables(view: EditorView, filePath: string): SnippetVariableResolver {
  const { state } = view;
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  const path = pathParts(filePath);
  return (name) => {
    switch (name) {
      case "TM_SELECTED_TEXT":
        return state.sliceDoc(main.from, main.to);
      case "TM_CURRENT_LINE":
        return line.text;
      case "TM_CURRENT_WORD": {
        const word = state.wordAt(main.head);
        return word ? state.sliceDoc(word.from, word.to) : "";
      }
      case "TM_LINE_INDEX":
        return String(line.number - 1);
      case "TM_LINE_NUMBER":
        return String(line.number);
      case "TM_FILENAME":
        return path.name;
      case "TM_FILENAME_BASE":
        return path.base;
      case "TM_DIRECTORY":
        return path.directory;
      case "TM_FILEPATH":
        return filePath;
      case "CLIPBOARD":
        return "";
      case "CURRENT_YEAR":
        return String(now.getFullYear());
      case "CURRENT_YEAR_SHORT":
        return String(now.getFullYear()).slice(-2);
      case "CURRENT_MONTH":
        return two(now.getMonth() + 1);
      case "CURRENT_DATE":
        return two(now.getDate());
      case "CURRENT_HOUR":
        return two(now.getHours());
      case "CURRENT_MINUTE":
        return two(now.getMinutes());
      case "CURRENT_SECOND":
        return two(now.getSeconds());
      case "CURRENT_SECONDS_UNIX":
        return String(Math.floor(now.getTime() / 1000));
      case "UUID":
        return crypto.randomUUID();
      default:
        return undefined;
    }
  };
}

function resolveEntry(client: LspClient, filePath: string, entry: LspCompletionEntry) {
  entry.resolving ??= client
    .resolveCompletionItem(filePath, entry.item)
    .then((resolved) => {
      entry.resolved = resolved;
      return resolved;
    })
    .catch(() => entry.item);
  return entry.resolving;
}

function renderCompletionInfo(item: CompletionItem): Node | null {
  const detail = item.detail?.trim();
  const documentation = createDocumentationElement(item.documentation, "cm-athas-completionDocs");
  if (!detail && !documentation) return null;
  const element = document.createElement("div");
  element.className = "cm-athas-completionInfo";
  if (detail) {
    const header = document.createElement("div");
    header.className = "cm-athas-completionInfoDetail";
    header.textContent = detail;
    element.append(header);
  }
  if (documentation) element.append(documentation);
  return element;
}

function runCompletionCommand(
  view: EditorView,
  client: LspClient,
  filePath: string,
  command: NonNullable<CompletionItem["command"]>,
) {
  if (command.command === "editor.action.triggerSuggest") {
    startCompletion(view);
  } else if (command.command === "editor.action.triggerParameterHints") {
    emitAppEvent("editor-trigger-signature-help");
  } else {
    void client.executeCommand(filePath, command.command, command.arguments ?? []).catch(() => {});
  }
}

/**
 * Completions from the language server, falling back to words in the document when there is
 * no server or it has nothing, as Monaco's word-based suggestions did.
 */
export function createLspCompletionSource(
  filePath: string,
  client: LspClient = LspClient.getInstance(),
): CompletionSource {
  const apply = (view: EditorView, completion: Completion, from: number, to: number) => {
    const entry = getLspCompletionEntry(completion);
    if (!entry) return;
    resolveEntry(client, filePath, entry);
    applyLspCompletion(view, completion, entry, from, to, {
      resolveVariable: snippetVariables(view, filePath),
      onCommand: (command) => runCompletionCommand(view, client, filePath, command),
    });
  };
  const info = async (completion: Completion) => {
    const entry = getLspCompletionEntry(completion);
    if (!entry) return null;
    return renderCompletionInfo(await resolveEntry(client, filePath, entry));
  };

  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const { state, pos } = context;
    const word = context.matchBefore(COMPLETION_WORD_BEFORE);
    const wordFrom = word ? word.from : pos;
    const before = state.sliceDoc(pos - 1, pos);
    const triggerCharacter =
      !word && COMPLETION_TRIGGER_CHARACTERS.has(before) ? before : undefined;
    if (!context.explicit && !word && !triggerCharacter) return null;
    if (!isLspFile(filePath)) {
      return triggerCharacter && !context.explicit
        ? null
        : wordCompletions(state.doc, pos, wordFrom);
    }

    const request: CompletionRequest = { filePath, doc: state.doc, position: pos, wordFrom };
    const position = toLspPosition(state.doc, pos);
    const items = await client.getCompletions(
      filePath,
      position.line,
      position.character,
      triggerCharacter ? 2 : 1,
      triggerCharacter,
    );
    if (context.aborted) return null;
    if (items.length === 0) {
      return triggerCharacter && !context.explicit
        ? null
        : wordCompletions(state.doc, pos, wordFrom);
    }
    return {
      from: wordFrom,
      options: items.map((item) => toCodeMirrorCompletion(item, request, apply, info)),
      validFor: COMPLETION_WORD,
    };
  };
}

function renderDescription(completion: Completion) {
  const item = getLspCompletionEntry(completion)?.item;
  const description = item?.labelDetails?.description;
  const detail = item?.detail?.split("\n", 1)[0];
  if (!description && !detail) return null;
  const element = document.createElement("span");
  element.className = "cm-athas-completionDescription";
  if (description) {
    element.textContent = description;
  } else if (detail) {
    element.classList.add("cm-athas-completionDescription-selectedOnly");
    element.textContent = detail;
  }
  return element;
}

function lspCompletionExtension(filePath: string, activateOnTyping: boolean): Extension {
  return [
    autocompletion({
      override: [createLspCompletionSource(filePath)],
      activateOnTyping,
      tooltipClass: () => "cm-athas-completion",
      optionClass: (completion) => {
        const item = getLspCompletionEntry(completion)?.item;
        return item && isDeprecatedCompletion(item) ? "cm-athas-completion-deprecated" : "";
      },
      addToOptions: [{ render: renderDescription, position: 90 }],
    }),
    Prec.high(keymap.of([{ key: "Tab", run: acceptCompletion }])),
  ];
}

/** The completion popup, fed by the language server, plus the `editor-trigger-suggest` command. */
export function LspCompletion({ host }: { host: CodeMirrorHost }) {
  const { view, filePath, isActiveSurface, isReadOnly } = host;
  const autoCompletion = useSettingsStore((state) => state.settings.autoCompletion);
  const extension = useMemo(
    () => (isReadOnly ? null : lspCompletionExtension(filePath, autoCompletion)),
    [autoCompletion, filePath, isReadOnly],
  );
  useCodeMirrorExtension(view, extension);

  useEffect(() => {
    if (!isActiveSurface || isReadOnly) return;
    const handleTriggerSuggest = () => {
      view.focus();
      startCompletion(view);
    };
    return onAppEvent("editor-trigger-suggest", handleTriggerSuggest);
  }, [isActiveSurface, isReadOnly, view]);

  return null;
}
