import { captureBufferStoreOwner, isBufferStoreOwnerLive } from "../../services/buffer-store-owner";
import { readBufferRevision, readBufferText } from "../../services/buffer-text";
import { flushAllLiveDocuments } from "../../services/live-document-registry";
import type { useBufferStore } from "../../stores/buffer.store";
import { getWorkspaceResourceProvider } from "@/features/file-system/services/workspace-resource-provider";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import {
  syncBufferHistoryContent,
  trackImmediateBufferHistoryChange,
} from "../../services/buffer-history-tracking";
import { emitGitChanged } from "@/features/git/events/git-events";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspTextEdit {
  range: {
    start: LspPosition;
    end: LspPosition;
  };
  newText: string;
}

interface TextDocumentEdit {
  textDocument: {
    uri: string;
    version?: number | null;
  };
  edits: LspTextEdit[];
}

export interface WorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<TextDocumentEdit | unknown>;
}

export interface WorkspaceEditApplyResult {
  editedFiles: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPosition(value: unknown): value is LspPosition {
  return (
    isObject(value) &&
    Number.isSafeInteger(value.line) &&
    Number.isSafeInteger(value.character) &&
    (value.line as number) >= 0 &&
    (value.line as number) <= 2147483647 &&
    (value.character as number) >= 0 &&
    (value.character as number) <= 2147483647
  );
}

function isTextEdit(value: unknown): value is LspTextEdit {
  return (
    isObject(value) &&
    isObject(value.range) &&
    isObject(value.range.start) &&
    isPosition(value.range.start) &&
    isObject(value.range.end) &&
    isPosition(value.range.end) &&
    typeof value.newText === "string" &&
    value.annotationId === undefined
  );
}

function isTextDocumentEdit(value: unknown): value is TextDocumentEdit {
  return (
    isObject(value) &&
    isObject(value.textDocument) &&
    typeof value.textDocument.uri === "string" &&
    (value.textDocument.version === undefined ||
      value.textDocument.version === null ||
      (Number.isInteger(value.textDocument.version) &&
        (value.textDocument.version as number) >= -2147483648 &&
        (value.textDocument.version as number) <= 2147483647)) &&
    Array.isArray(value.edits) &&
    value.edits.every(isTextEdit)
  );
}

export function isWorkspaceEdit(value: unknown): value is WorkspaceEdit {
  if (!isObject(value)) return false;

  if (value.documentChanges !== undefined)
    return Array.isArray(value.documentChanges) && value.documentChanges.every(isTextDocumentEdit);
  if (value.changes === undefined) return Object.keys(value).length === 0;
  return (
    isObject(value.changes) &&
    Object.values(value.changes).every((edits) => Array.isArray(edits) && edits.every(isTextEdit))
  );
}

export function filePathFromUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;

  try {
    const url = new URL(uri);
    const path = decodeURIComponent(url.pathname);
    if (url.hostname && url.hostname !== "localhost") return `//${url.hostname}${path}`;
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    throw new Error("Language server returned an invalid file URI");
  }
}

export function normalizeWorkspaceEditPath(path: string): string {
  if (/^[A-Za-z]:[\\/]/.test(path))
    return path[0].toUpperCase() + path.slice(1).replace(/\\/g, "/");
  return path.startsWith("\\\\") ? path.replace(/\\/g, "/") : path;
}
export function fileUriFromPath(filePath: string): string {
  const normalized = normalizeWorkspaceEditPath(filePath);
  const pathname = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const encoded = encodeURI(pathname)
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F")
    .replace(/\\/g, "%5C");
  return normalized.startsWith("//") ? `file:${encoded}` : `file://${encoded}`;
}
function workspaceEditPath(uri: string): string {
  if (!uri.startsWith("file://")) throw new Error("Workspace edits require a file URI");
  const url = new URL(uri);
  const path = normalizeWorkspaceEditPath(filePathFromUri(uri));
  if (
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    path.includes("\0") ||
    (!path.startsWith("/") && !/^[A-Z]:\//.test(path))
  )
    throw new Error("Language server returned an invalid file URI");
  return path;
}

function buildLineOffsets(content: string): Array<{ start: number; end: number }> {
  const lines: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let index = 0; index < content.length; index++) {
    if (content[index] !== "\r" && content[index] !== "\n") continue;
    lines.push({ start, end: index });
    if (content[index] === "\r" && content[index + 1] === "\n") index++;
    start = index + 1;
  }
  lines.push({ start, end: content.length });
  return lines;
}

function offsetWithLines(
  content: string,
  position: LspPosition,
  lines: Array<{ start: number; end: number }>,
): number {
  if (!isPosition(position)) throw new Error("Language server returned an invalid text position");
  const line = lines[position.line];
  return line ? line.start + Math.min(position.character, line.end - line.start) : content.length;
}
export function offsetFromPosition(content: string, position: LspPosition): number {
  return offsetWithLines(content, position, buildLineOffsets(content));
}
export function applyTextEditsToContent(content: string, edits: LspTextEdit[]): string {
  const lines = buildLineOffsets(content);
  const positioned = edits
    .map((edit, index) => {
      if (!isTextEdit(edit)) throw new Error("Language server returned an unsupported text edit");
      const startOffset = offsetWithLines(content, edit.range.start, lines);
      const endOffset = offsetWithLines(content, edit.range.end, lines);
      if (
        edit.range.start.line > edit.range.end.line ||
        (edit.range.start.line === edit.range.end.line &&
          edit.range.start.character > edit.range.end.character) ||
        startOffset > endOffset
      )
        throw new Error("Language server returned a reversed text range");
      return { edit, index, startOffset, endOffset };
    })
    .sort(
      (a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset || a.index - b.index,
    );
  for (let index = 1; index < positioned.length; index++) {
    const previous = positioned[index - 1];
    const current = positioned[index];
    if (
      previous.startOffset === current.startOffset &&
      previous.startOffset === previous.endOffset &&
      current.startOffset < current.endOffset &&
      previous.index > current.index
    )
      throw new Error("Inserts must precede a replacement at the same position");
  }
  let previousEnd = -1;
  for (const entry of positioned) {
    if (entry.startOffset < previousEnd)
      throw new Error("Language server returned overlapping text edits");
    previousEnd = entry.endOffset;
  }
  let result = content;
  for (let index = positioned.length - 1; index >= 0; index--) {
    const { edit, startOffset, endOffset } = positioned[index];
    result = result.slice(0, startOffset) + edit.newText + result.slice(endOffset);
  }
  return result;
}

interface DocumentOperation {
  path: string;
  edits: LspTextEdit[];
  version?: number | null;
  changeIndex: number;
}
function collectDocumentOperations(edit: WorkspaceEdit): DocumentOperation[] {
  if (!isWorkspaceEdit(edit))
    throw new Error("Language server returned an unsupported workspace edit");
  if (edit.documentChanges !== undefined)
    return edit.documentChanges.map((change, index) => {
      if (!isTextDocumentEdit(change)) throw new Error("Unsupported workspace resource operation");
      return {
        path: workspaceEditPath(change.textDocument.uri),
        edits: change.edits,
        version: change.textDocument.version,
        changeIndex: index,
      };
    });
  const operations = new Map<string, DocumentOperation>();
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    const path = workspaceEditPath(uri);
    const existing = operations.get(path);
    if (existing) existing.edits.push(...edits);
    else operations.set(path, { path, edits: [...edits], changeIndex: operations.size });
  }
  return [...operations.values()];
}

export interface WorkspaceEditContext {
  workspaceId: string;
  store: ReturnType<typeof useBufferStore.getStore>;
  sources: Map<string, EditorContent>;
  getDocumentVersion?: (path: string) => number | undefined;
  isCurrent?: () => boolean;
  beforeApply?: () => Promise<void>;
  onBufferApplied?: (buffer: EditorContent) => void;
}
export function captureWorkspaceEditContext(
  workspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId(),
): WorkspaceEditContext {
  const { store } = captureBufferStoreOwner(workspaceId);
  // The snapshot below must hold the text as the user sees it, including edits an editor view
  // has not written to the store yet.
  flushAllLiveDocuments();
  const sources = new Map<string, EditorContent>();
  for (const buffer of store.getState().buffers)
    if (buffer.type === "editor") sources.set(normalizeWorkspaceEditPath(buffer.path), buffer);
  return { workspaceId, store, sources };
}
export function isWorkspaceEditContextLive(
  context: Pick<WorkspaceEditContext, "workspaceId" | "store" | "isCurrent">,
) {
  return context.isCurrent?.() !== false && isBufferStoreOwnerLive(context);
}
function assertOwner(context: WorkspaceEditContext) {
  if (!isWorkspaceEditContextLive(context))
    throw new Error("The workspace edit owner is no longer available");
}
function currentEditor(context: WorkspaceEditContext, path: string): EditorContent | undefined {
  return context.store
    .getState()
    .buffers.find(
      (buffer): buffer is EditorContent =>
        buffer.type === "editor" && normalizeWorkspaceEditPath(buffer.path) === path,
    );
}
function sameSource(current: EditorContent | undefined, source: EditorContent) {
  return (
    current &&
    current.id === source.id &&
    current.path === source.path &&
    readBufferRevision(current) === (source.contentRevision ?? 0) &&
    readBufferText(current) === source.content &&
    !current.readOnly &&
    !current.isVirtual
  );
}
interface PreparedEdit {
  path: string;
  content: string;
  nextContent: string;
  buffer?: EditorContent;
  version?: number | null;
  changeIndex: number;
}
export class WorkspaceEditFailure extends Error {
  constructor(
    message: string,
    readonly editedFiles: number,
    readonly failedChange: number,
  ) {
    super(
      editedFiles > 0
        ? `${message}. ${editedFiles} file(s) were already changed; remaining edits were stopped.`
        : message,
    );
    this.name = "WorkspaceEditFailure";
  }
}
async function prepareEdits(
  edit: WorkspaceEdit,
  context: WorkspaceEditContext,
): Promise<PreparedEdit[]> {
  const grouped = new Map<string, DocumentOperation[]>();
  for (const operation of collectDocumentOperations(edit))
    grouped.set(operation.path, [...(grouped.get(operation.path) ?? []), operation]);
  const prepared = await Promise.all(
    [...grouped].map(async ([path, operations]) => {
      const changeIndex = operations[0].changeIndex;
      assertOwner(context);
      const buffer = context.sources.get(path);
      let content: string;
      if (buffer) {
        if (!sameSource(currentEditor(context, path), buffer))
          throw new WorkspaceEditFailure(
            `The document changed before the edit: ${path}`,
            0,
            changeIndex,
          );
        content = buffer.content;
      } else {
        try {
          content = await getWorkspaceResourceProvider(path).readText(path);
        } catch (error) {
          throw new WorkspaceEditFailure(
            error instanceof Error ? error.message : String(error),
            0,
            changeIndex,
          );
        }
      }
      const baseVersion = context.getDocumentVersion?.(path);
      let virtualVersion = baseVersion;
      let version: number | undefined;
      let nextContent = content;
      const steps: PreparedEdit[] = [];
      for (const operation of operations) {
        if (typeof operation.version === "number") {
          if (virtualVersion !== operation.version)
            throw new WorkspaceEditFailure(
              `The document version changed: ${path}`,
              0,
              operation.changeIndex,
            );
          version = baseVersion;
        }
        const previousContent = nextContent;
        try {
          nextContent = applyTextEditsToContent(nextContent, operation.edits);
        } catch (error) {
          throw new WorkspaceEditFailure(
            error instanceof Error ? error.message : String(error),
            0,
            operation.changeIndex,
          );
        }
        steps.push({
          path,
          content: previousContent,
          nextContent,
          buffer,
          changeIndex: operation.changeIndex,
        });
        if (virtualVersion !== undefined) virtualVersion++;
      }
      if (steps[0]) steps[0].version = version;
      return steps;
    }),
  );
  return prepared.flat().sort((first, second) => first.changeIndex - second.changeIndex);
}
function validatePrepared(context: WorkspaceEditContext, entry: PreparedEdit) {
  assertOwner(context);
  if (
    typeof entry.version === "number" &&
    context.getDocumentVersion?.(entry.path) !== entry.version
  )
    throw new Error(`The document version changed: ${entry.path}`);
  const current = currentEditor(context, entry.path);
  if (
    entry.buffer
      ? !sameSource(current, entry.buffer)
      : current &&
        (current.readOnly ||
          current.isVirtual ||
          current.isDirty ||
          readBufferText(current) !== entry.content)
  )
    throw new Error(`The document changed before the edit: ${entry.path}`);
}
const editQueues = new WeakMap<WorkspaceEditContext["store"], Promise<unknown>>();
export function applyWorkspaceEdit(
  edit: WorkspaceEdit,
  context = captureWorkspaceEditContext(),
): Promise<WorkspaceEditApplyResult> {
  const previous = editQueues.get(context.store) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(async () => {
      assertOwner(context);
      const prepared = await prepareEdits(edit, context);
      await context.beforeApply?.();
      assertOwner(context);
      const validated = new Set<string>();
      for (const entry of prepared) {
        if (validated.has(entry.path)) continue;
        validated.add(entry.path);
        try {
          validatePrepared(context, entry);
        } catch (error) {
          throw new WorkspaceEditFailure(
            error instanceof Error ? error.message : String(error),
            0,
            entry.changeIndex,
          );
        }
      }
      const edited = new Set<string>();
      const historyTracked = new Set<string>();
      const appliedSources = new Map<string, EditorContent>();
      for (const entry of prepared) {
        try {
          validatePrepared(context, {
            ...entry,
            buffer: appliedSources.get(entry.path) ?? entry.buffer,
          });
          if (entry.nextContent === entry.content) continue;
          const buffer = currentEditor(context, entry.path);
          if (buffer) {
            if (!historyTracked.has(buffer.id)) {
              trackImmediateBufferHistoryChange({
                bufferId: buffer.id,
                currentContent: readBufferText(buffer),
                nextContent: entry.nextContent,
                workspaceId: context.workspaceId,
              });
              historyTracked.add(buffer.id);
            } else syncBufferHistoryContent(buffer.id, entry.nextContent, context.workspaceId);
            const expectedRevision = readBufferRevision(buffer) + 1;
            context.store
              .getState()
              .actions.updateBufferContent(buffer.id, entry.nextContent, true);
            edited.add(entry.path);
            const applied = currentEditor(context, entry.path);
            if (
              !applied ||
              applied.id !== buffer.id ||
              applied.content !== entry.nextContent ||
              (applied.contentRevision ?? 0) !== expectedRevision
            )
              throw new Error(`The document changed while applying the edit: ${entry.path}`);
            appliedSources.set(entry.path, applied);
            context.onBufferApplied?.(applied);
          } else {
            await getWorkspaceResourceProvider(entry.path).writeText(
              entry.path,
              entry.nextContent,
              entry.content,
            );
            edited.add(entry.path);
            const ownerLive =
              workspaceRuntimeRegistry
                .getWorkspace(context.workspaceId)
                ?.stores.get("editor-buffer") === context.store;
            const opened = ownerLive ? currentEditor(context, entry.path) : undefined;
            if (
              opened &&
              !opened.isVirtual &&
              (opened.savedContent === entry.content || opened.savedContent === entry.nextContent)
            ) {
              if (!opened.readOnly && !opened.isDirty && readBufferText(opened) === entry.content)
                context.store
                  .getState()
                  .actions.updateBufferContent(opened.id, entry.nextContent, false);
              context.store.getState().actions.markBufferSaved(opened.id, entry.nextContent);
            }
            emitGitChanged({
              filePath: entry.path,
              scopes: ["working-tree"],
              source: "external-file-change",
            });
          }
        } catch (error) {
          throw new WorkspaceEditFailure(
            error instanceof Error ? error.message : String(error),
            edited.size,
            entry.changeIndex,
          );
        }
      }
      return { editedFiles: edited.size };
    })
    .finally(() => {
      if (editQueues.get(context.store) === task) editQueues.delete(context.store);
    });
  editQueues.set(context.store, task);
  return task;
}
