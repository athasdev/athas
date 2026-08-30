import {
  Emitter,
  editor as monacoEditor,
  languages,
  Range as MonacoRange,
  Uri,
} from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { toast } from "sonner";
import type { CompletionItem, Hover, SelectionRange } from "vscode-languageserver-protocol";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { formatHoverContents } from "@/features/editor/lsp/hover-content";
import { useLspStore } from "@/features/editor/lsp/stores/lsp.store";
import {
  collectWorkspaceTextEdits,
  filePathFromUri,
  isWorkspaceEdit,
  type LspTextEdit,
} from "@/features/editor/lsp/workspace-edit";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { MONACO_HIGHLIGHT_LANGUAGE_IDS } from "./language";
import { filePathFromAthasModelUri } from "./model-uri";
import { createMonacoSemanticTokenProvider } from "./semantic-token-provider";

let providersRegistered = false;
const EXECUTE_LSP_CODE_ACTION_COMMAND = "athas.executeLspCodeAction";
const EXECUTE_LSP_COMPLETION_COMMAND = "athas.executeLspCompletionCommand";

interface ExecuteLspCodeActionPayload {
  filePath: string;
  actionPayload: unknown;
  title: string;
}

interface ExecuteLspCompletionCommandPayload {
  filePath: string;
  command: string;
  arguments?: unknown[];
}

function filePathFromModel(model: Monaco.editor.ITextModel): string {
  if (model.uri.scheme === "file") {
    return filePathFromUri(model.uri.toString());
  }

  if (model.uri.scheme !== "athas") {
    return decodeURIComponent(model.uri.path);
  }

  return filePathFromAthasModelUri(model.uri.path, model.uri.query);
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

function toMonacoSelectionRanges(
  selectionRange: SelectionRange,
): Monaco.languages.SelectionRange[] {
  const ranges: Monaco.languages.SelectionRange[] = [];
  let current: SelectionRange | undefined = selectionRange;

  while (current) {
    ranges.push({ range: toMonacoRange(current.range) });
    current = current.parent;
  }

  return ranges;
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

export function toMonacoCompletionItem(
  item: CompletionItem,
  fallbackRange: Monaco.IRange | Monaco.languages.CompletionItemRanges,
  filePath?: string,
): Monaco.languages.CompletionItem {
  const label = completionLabelText(item.label);
  const insertText =
    item.textEdit && "newText" in item.textEdit ? item.textEdit.newText : item.insertText || label;
  const range = item.textEdit
    ? "insert" in item.textEdit
      ? {
          insert: toMonacoRange(item.textEdit.insert),
          replace: toMonacoRange(item.textEdit.replace),
        }
      : toMonacoRange(item.textEdit.range)
    : fallbackRange;
  const tags =
    item.tags?.includes(1) || item.deprecated
      ? [languages.CompletionItemTag.Deprecated]
      : undefined;

  return {
    label: item.labelDetails
      ? {
          label,
          detail: item.labelDetails.detail,
          description: item.labelDetails.description,
        }
      : label,
    kind: mapCompletionKind(item.kind),
    tags,
    detail: item.detail,
    documentation: markupDocumentation(item.documentation),
    insertText,
    range,
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    commitCharacters: item.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.map(toMonacoTextEdit),
    command:
      item.command && filePath
        ? {
            id: EXECUTE_LSP_COMPLETION_COMMAND,
            title: item.command.title,
            arguments: [
              {
                filePath,
                command: item.command.command,
                arguments: item.command.arguments,
              } satisfies ExecuteLspCompletionCommandPayload,
            ],
          }
        : undefined,
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

function withoutPayloadEdit(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const copy = { ...(payload as Record<string, unknown>) };
  delete copy.edit;
  return copy;
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
  const completionSources = new WeakMap<
    Monaco.languages.CompletionItem,
    {
      filePath: string;
      item: CompletionItem;
      fallbackRange: Monaco.IRange | Monaco.languages.CompletionItemRanges;
    }
  >();
  const semanticTokensChanged = new Emitter<void>();
  useLspStore.subscribe((state, previousState) => {
    const currentStatus = state.lspStatus;
    const previousStatus = previousState.lspStatus;
    if (
      currentStatus.status !== previousStatus.status ||
      currentStatus.documentRevision !== previousStatus.documentRevision
    ) {
      semanticTokensChanged.fire();
    }
  });

  languages.registerDocumentSemanticTokensProvider(
    selector,
    createMonacoSemanticTokenProvider({
      client: lspClient,
      filePathFromModel,
      isLspModel,
      onDidChange: semanticTokensChanged.event,
    }),
  );

  languages.registerFoldingRangeProvider(selector, {
    async provideFoldingRanges(model) {
      if (!isLspModel(model)) return [];

      const ranges = await lspClient.getFoldingRanges(filePathFromModel(model));
      return ranges.map((range) => ({
        start: range.startLine + 1,
        end: range.endLine + 1,
        kind: range.kind ? languages.FoldingRangeKind.fromValue(range.kind) : undefined,
      }));
    },
  });

  languages.registerSelectionRangeProvider(selector, {
    async provideSelectionRanges(model, positions) {
      if (!isLspModel(model)) return [];

      const ranges = await lspClient.getSelectionRanges(
        filePathFromModel(model),
        positions.map((position) => ({
          line: position.lineNumber - 1,
          character: position.column - 1,
        })),
      );
      return ranges.map(toMonacoSelectionRanges);
    },
  });

  languages.registerDocumentHighlightProvider(selector, {
    async provideDocumentHighlights(model, position) {
      if (!isLspModel(model)) return [];

      const highlights = await lspClient.getDocumentHighlights(
        filePathFromModel(model),
        position.lineNumber - 1,
        position.column - 1,
      );
      return highlights.map((highlight) => ({
        range: toMonacoRange(highlight.range),
        kind:
          highlight.kind === 2
            ? languages.DocumentHighlightKind.Read
            : highlight.kind === 3
              ? languages.DocumentHighlightKind.Write
              : languages.DocumentHighlightKind.Text,
      }));
    },
  });

  languages.registerOnTypeFormattingEditProvider(selector, {
    autoFormatTriggerCharacters: [";", "\n", "}"],
    async provideOnTypeFormattingEdits(model, position, ch, options) {
      if (!isLspModel(model)) return [];

      const filePath = filePathFromModel(model);
      const triggerCharacters = await lspClient.getOnTypeFormattingTriggerCharacters(filePath);
      if (!triggerCharacters.includes(ch)) return [];

      const edits = await lspClient.formatOnType(
        filePath,
        position.lineNumber - 1,
        position.column - 1,
        ch,
        options.tabSize,
        options.insertSpaces,
      );
      return edits.map(toMonacoTextEdit);
    },
  });

  languages.registerCompletionItemProvider(selector, {
    triggerCharacters: [".", ":", "<", '"', "'", "/", "@", "#", "*", " "],
    async provideCompletionItems(model, position, context) {
      if (!isLspModel(model)) return { suggestions: [] };

      const filePath = filePathFromModel(model);
      const completions = await lspClient.getCompletions(
        filePath,
        position.lineNumber - 1,
        position.column - 1,
        context.triggerKind + 1,
        context.triggerCharacter,
      );
      const word = model.getWordUntilPosition(position);
      const range = new MonacoRange(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );

      return {
        suggestions: completions.map((item) => {
          const suggestion = toMonacoCompletionItem(item, range, filePath);
          completionSources.set(suggestion, { filePath, item, fallbackRange: range });
          return suggestion;
        }),
      };
    },
    async resolveCompletionItem(item) {
      const source = completionSources.get(item);
      if (!source) return item;

      const resolved = await lspClient.resolveCompletionItem(source.filePath, source.item);
      const suggestion = toMonacoCompletionItem(resolved, source.fallbackRange, source.filePath);
      completionSources.set(suggestion, { ...source, item: resolved });
      return suggestion;
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
        return {
          range: new MonacoRange(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
          text: "",
        };
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
            ? new MonacoRange(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn,
              )
            : new MonacoRange(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
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
    async provideCodeActions(model, range, context) {
      if (!isLspModel(model)) return { actions: [], dispose: () => {} };

      const filePath = filePathFromModel(model);
      const diagnostics = context.markers.map(
        (marker) =>
          ({
            severity: marker.severity === 8 ? "error" : marker.severity === 4 ? "warning" : "info",
            filePath,
            line: marker.startLineNumber - 1,
            column: marker.startColumn - 1,
            endLine: marker.endLineNumber - 1,
            endColumn: marker.endColumn - 1,
            message: marker.message,
            source: marker.source,
            code: typeof marker.code === "string" ? marker.code : undefined,
          }) as const,
      );
      const lspActions = await lspClient.getCodeActions(
        filePath,
        {
          startLine: range.startLineNumber - 1,
          startColumn: range.startColumn - 1,
          endLine: range.endLineNumber - 1,
          endColumn: range.endColumn - 1,
        },
        diagnostics,
      );
      const actions = lspActions
        .filter((action) => !action.disabledReason)
        .map((action): Monaco.languages.CodeAction => {
          const edit = toWorkspaceEdit(getPayloadEdit(action.payload));
          const command = action.hasCommand
            ? {
                id: EXECUTE_LSP_CODE_ACTION_COMMAND,
                title: action.title,
                arguments: [
                  {
                    filePath,
                    actionPayload: edit ? withoutPayloadEdit(action.payload) : action.payload,
                    title: action.title,
                  } satisfies ExecuteLspCodeActionPayload,
                ],
              }
            : undefined;

          return {
            title: action.title,
            kind: codeActionKind(action.kind),
            diagnostics: context.markers,
            isPreferred: action.isPreferred,
            edit,
            command,
          };
        })
        .filter((action) => action.edit || action.command);

      return { actions, dispose: () => {} };
    },
  });

  monacoEditor.addCommand({
    id: EXECUTE_LSP_COMPLETION_COMMAND,
    run: (_accessor, payload: ExecuteLspCompletionCommandPayload | undefined) => {
      if (!payload?.filePath || !payload.command) return;
      void lspClient.executeCommand(payload.filePath, payload.command, payload.arguments);
    },
  });

  monacoEditor.addCommand({
    id: EXECUTE_LSP_CODE_ACTION_COMMAND,
    run: (_accessor, payload: ExecuteLspCodeActionPayload | undefined) => {
      if (!payload?.filePath || !payload.actionPayload) return;
      void lspClient.applyCodeAction(payload.filePath, payload.actionPayload).then((result) => {
        if (!result.applied) {
          toast.error(result.reason || `Failed to run ${payload.title}`);
        }
      });
    },
  });
}
