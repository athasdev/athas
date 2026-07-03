import { languages, Range as MonacoRange, Uri } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import type { CompletionItem, Hover } from "vscode-languageserver-protocol";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { formatHoverContents } from "@/features/editor/lsp/hover-content";
import {
  collectWorkspaceTextEdits,
  filePathFromUri,
  isWorkspaceEdit,
  type LspTextEdit,
} from "@/features/editor/lsp/workspace-edit";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { MONACO_HIGHLIGHT_LANGUAGE_IDS } from "./language";

let providersRegistered = false;

function filePathFromModel(model: Monaco.editor.ITextModel): string {
  if (model.uri.scheme === "file") {
    return filePathFromUri(model.uri.toString());
  }

  if (model.uri.scheme !== "athas") {
    return decodeURIComponent(model.uri.path);
  }

  const [, _bufferId, ...pathParts] = model.uri.path.split("/");
  const decodedPath = decodeURIComponent(pathParts.join("/"));
  if (/^[A-Za-z]:\//.test(decodedPath)) return decodedPath;
  return decodedPath.startsWith("/") ? decodedPath : `/${decodedPath}`;
}

function toMonacoRange(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}) {
  return new MonacoRange(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function toMonacoTextEdit(edit: LspTextEdit): Monaco.languages.TextEdit {
  return {
    range: toMonacoRange(edit.range),
    text: edit.newText,
  };
}

function completionLabelText(label: CompletionItem["label"]): string {
  return label;
}

function mapCompletionKind(kind: CompletionItem["kind"]): Monaco.languages.CompletionItemKind {
  const monacoKind = languages.CompletionItemKind;
  switch (kind) {
    case 1:
      return monacoKind.Text;
    case 2:
      return monacoKind.Method;
    case 3:
      return monacoKind.Function;
    case 4:
      return monacoKind.Constructor;
    case 5:
      return monacoKind.Field;
    case 6:
      return monacoKind.Variable;
    case 7:
      return monacoKind.Class;
    case 8:
      return monacoKind.Interface;
    case 9:
      return monacoKind.Module;
    case 10:
      return monacoKind.Property;
    case 11:
      return monacoKind.Unit;
    case 12:
      return monacoKind.Value;
    case 13:
      return monacoKind.Enum;
    case 14:
      return monacoKind.Keyword;
    case 15:
      return monacoKind.Snippet;
    case 16:
      return monacoKind.Color;
    case 17:
      return monacoKind.File;
    case 18:
      return monacoKind.Reference;
    case 21:
      return monacoKind.Constant;
    case 22:
      return monacoKind.Struct;
    case 23:
      return monacoKind.Event;
    case 24:
      return monacoKind.Operator;
    case 25:
      return monacoKind.TypeParameter;
    default:
      return monacoKind.Text;
  }
}

function markupDocumentation(
  value: CompletionItem["documentation"] | CompletionItem["detail"],
): Monaco.IMarkdownString | string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "value" in value && typeof value.value === "string") {
    return { value: value.value };
  }
  return undefined;
}

function toCompletionItem(
  item: CompletionItem,
  range: Monaco.IRange,
): Monaco.languages.CompletionItem {
  const label = completionLabelText(item.label);
  const insertText =
    item.textEdit && "newText" in item.textEdit
      ? item.textEdit.newText
      : item.insertText || label;

  return {
    label,
    kind: mapCompletionKind(item.kind),
    detail: item.detail,
    documentation: markupDocumentation(item.documentation),
    insertText,
    range:
      item.textEdit && "range" in item.textEdit
        ? toMonacoRange(item.textEdit.range)
        : range,
    sortText: item.sortText,
    filterText: item.filterText,
    commitCharacters: item.commitCharacters,
    insertTextRules:
      item.insertTextFormat === 2
        ? languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
  };
}

function hoverToMarkdown(hover: Hover | null): Monaco.IMarkdownString[] {
  if (!hover?.contents) return [];
  const value = formatHoverContents(hover.contents);
  return value ? [{ value }] : [];
}

function codeActionKind(kind: string | undefined): string {
  if (!kind) return "quickfix";
  if (kind.startsWith("quickfix")) return "quickfix";
  if (kind.startsWith("refactor")) return "refactor";
  if (kind.startsWith("source")) return "source";
  return kind;
}

function getPayloadEdit(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return null;
  return (payload as { edit?: unknown }).edit;
}

function toWorkspaceEdit(edit: unknown): Monaco.languages.WorkspaceEdit | undefined {
  if (!isWorkspaceEdit(edit)) return undefined;

  const edits: Monaco.languages.IWorkspaceTextEdit[] = [];
  for (const [filePath, textEdits] of collectWorkspaceTextEdits(edit)) {
    const resource = Uri.file(filePath);
    for (const textEdit of textEdits) {
      edits.push({
        resource,
        textEdit: toMonacoTextEdit(textEdit),
        versionId: undefined,
      });
    }
  }

  return edits.length > 0 ? { edits } : undefined;
}

function isLspModel(model: Monaco.editor.ITextModel): boolean {
  const filePath = filePathFromModel(model);
  return Boolean(filePath && extensionRegistry.isLspSupported(filePath));
}

export function registerMonacoLspProviders() {
  if (providersRegistered) return;
  providersRegistered = true;

  const selector = Array.from(MONACO_HIGHLIGHT_LANGUAGE_IDS);
  const lspClient = LspClient.getInstance();

  languages.registerCompletionItemProvider(selector, {
    triggerCharacters: [".", ":", "<", "\"", "'", "/", "@", "#"],
    async provideCompletionItems(model, position) {
      if (!isLspModel(model)) return { suggestions: [] };

      const filePath = filePathFromModel(model);
      const completions = await lspClient.getCompletions(
        filePath,
        position.lineNumber - 1,
        position.column - 1,
      );
      const word = model.getWordUntilPosition(position);
      const range = new MonacoRange(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );

      return {
        suggestions: completions.map((item) => toCompletionItem(item, range)),
      };
    },
  });

  languages.registerHoverProvider(selector, {
    async provideHover(model, position) {
      if (!isLspModel(model)) return null;

      const hover = await lspClient.getHover(
        filePathFromModel(model),
        position.lineNumber - 1,
        position.column - 1,
      );
      const contents = hoverToMarkdown(hover);
      return contents.length > 0 ? { contents } : null;
    },
  });

  languages.registerDefinitionProvider(selector, {
    async provideDefinition(model, position) {
      if (!isLspModel(model)) return [];

      const locations = await lspClient.getDefinition(
        filePathFromModel(model),
        position.lineNumber - 1,
        position.column - 1,
      );
      return (locations ?? []).map((location) => ({
        uri: Uri.file(filePathFromUri(location.uri)),
        range: toMonacoRange(location.range),
      }));
    },
  });

  languages.registerImplementationProvider(selector, {
    async provideImplementation(model, position) {
      if (!isLspModel(model)) return [];

      const locations = await lspClient.getImplementation(
        filePathFromModel(model),
        position.lineNumber - 1,
        position.column - 1,
      );
      return (locations ?? []).map((location) => ({
        uri: Uri.file(filePathFromUri(location.uri)),
        range: toMonacoRange(location.range),
      }));
    },
  });

  languages.registerTypeDefinitionProvider(selector, {
    async provideTypeDefinition(model, position) {
      if (!isLspModel(model)) return [];

      const locations = await lspClient.getTypeDefinition(
        filePathFromModel(model),
        position.lineNumber - 1,
        position.column - 1,
      );
      return (locations ?? []).map((location) => ({
        uri: Uri.file(filePathFromUri(location.uri)),
        range: toMonacoRange(location.range),
      }));
    },
  });

  languages.registerReferenceProvider(selector, {
    async provideReferences(model, position) {
      if (!isLspModel(model)) return [];

      const locations = await lspClient.getReferences(
        filePathFromModel(model),
        position.lineNumber - 1,
        position.column - 1,
      );
      return (locations ?? []).map((location) => ({
        uri: Uri.file(filePathFromUri(location.uri)),
        range: toMonacoRange(location.range),
      }));
    },
  });

  languages.registerRenameProvider(selector, {
    async resolveRenameLocation(model, position) {
      if (!isLspModel(model)) {
        return { range: new MonacoRange(position.lineNumber, position.column, position.lineNumber, position.column), text: "" };
      }

      const prepared = await lspClient.prepareRename(
        filePathFromModel(model),
        position.lineNumber - 1,
        position.column - 1,
      );
      const range =
        prepared?.range ??
        (prepared?.start && prepared?.end ? { start: prepared.start, end: prepared.end } : null);

      if (!range) {
        const word = model.getWordAtPosition(position);
        return {
          range: word
            ? new MonacoRange(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
            : new MonacoRange(position.lineNumber, position.column, position.lineNumber, position.column),
          text: prepared?.placeholder || word?.word || "",
        };
      }

      const monacoRange = toMonacoRange(range);
      return {
        range: monacoRange,
        text: prepared?.placeholder || model.getValueInRange(monacoRange),
      };
    },
    async provideRenameEdits(model, position, newName) {
      if (!isLspModel(model)) return undefined;

      const edit = await lspClient.rename(
        filePathFromModel(model),
        position.lineNumber - 1,
        position.column - 1,
        newName,
      );
      return toWorkspaceEdit(edit);
    },
  });

  languages.registerCodeActionProvider(selector, {
    async provideCodeActions(model, _range, context) {
      if (!isLspModel(model)) return { actions: [], dispose: () => {} };

      const filePath = filePathFromModel(model);
      const actions: Monaco.languages.CodeAction[] = [];
      for (const marker of context.markers.slice(0, 3)) {
        const diagnostic = {
          severity: marker.severity === 8 ? "error" : marker.severity === 4 ? "warning" : "info",
          filePath,
          line: marker.startLineNumber - 1,
          column: marker.startColumn - 1,
          endLine: marker.endLineNumber - 1,
          endColumn: marker.endColumn - 1,
          message: marker.message,
          source: marker.source,
          code: typeof marker.code === "string" ? marker.code : undefined,
        } as const;
        const lspActions = await lspClient.getCodeActions(filePath, diagnostic);
        for (const action of lspActions) {
          if (action.disabledReason) continue;
          const edit = toWorkspaceEdit(getPayloadEdit(action.payload));
          if (!edit) continue;
          actions.push({
            title: action.title,
            kind: codeActionKind(action.kind),
            diagnostics: [marker],
            isPreferred: action.isPreferred,
            edit,
          });
        }
      }

      return { actions, dispose: () => {} };
    },
  });
}
