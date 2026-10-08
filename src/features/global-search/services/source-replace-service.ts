import type { SearchMatch } from "@/features/file-search/api/file-search-api";
import {
  captureBufferStoreOwner,
  isBufferStoreOwnerLive,
  type BufferStoreOwner,
} from "@/features/editor/services/buffer-store-owner";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { readBufferRevision, readBufferText } from "@/features/editor/services/buffer-text";
import { flushAllLiveDocuments } from "@/features/editor/services/live-document-registry";
import { trackImmediateBufferHistoryChange } from "@/features/editor/stores/buffer-history-tracking";
import { emitGitChanged } from "@/features/git/events/git-events";
import { buildSearchRegex } from "@/features/editor/utils/search";
import { getWorkspaceResourceProvider } from "@/features/file-system/services/workspace-resource-provider";
import { createSearchWorkerSession } from "./search-worker-client";
import type { ContentSearchOptions } from "../types/global-search.types";

interface ReplaceTarget {
  filePath: string;
  line: number;
  column: number;
  expectedLine?: string;
}

interface SourceContent {
  buffer?: EditorContent;
  content: string;
  revision?: number;
}
export interface SourceReplaceContext extends BufferStoreOwner {
  sources: Map<string, EditorContent>;
  expectedMatches?: Map<string, SearchMatch[]>;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}
export function captureSourceReplaceContext(workspaceId?: string): SourceReplaceContext {
  const owner = captureBufferStoreOwner(workspaceId);
  flushAllLiveDocuments();
  const sources = new Map<string, EditorContent>();
  for (const buffer of owner.store.getState().buffers)
    if (buffer.type === "editor") sources.set(buffer.path, buffer);
  return { ...owner, sources };
}
export class SourceReplaceFailure extends Error {
  constructor(
    message: string,
    readonly replacements: number,
    readonly editedFiles: number,
    readonly filePath?: string,
  ) {
    super(
      editedFiles
        ? `${message} Replaced ${replacements} match(es) in ${editedFiles} file(s) before stopping.`
        : message,
    );
    this.name = "SourceReplaceFailure";
  }
}
const REPLACE_READ_CONCURRENCY = 8;
const replaceQueues = new WeakMap<SourceReplaceContext["store"], Promise<unknown>>();
function queueReplacement<T>(context: SourceReplaceContext, run: () => Promise<T>): Promise<T> {
  const previous = replaceQueues.get(context.store) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(() => {
      assertOwner(context);
      return run();
    })
    .finally(() => {
      if (replaceQueues.get(context.store) === task) replaceQueues.delete(context.store);
    });
  replaceQueues.set(context.store, task);
  return task;
}
function assertOwner(context: SourceReplaceContext) {
  if (
    !isBufferStoreOwnerLive(context) ||
    context.signal?.aborted ||
    context.isCurrent?.() === false
  )
    throw new Error("The replacement workspace or search view is no longer available.");
}
function currentSource(context: SourceReplaceContext, filePath: string) {
  return context.store
    .getState()
    .buffers.find(
      (buffer): buffer is EditorContent => buffer.type === "editor" && buffer.path === filePath,
    );
}
function validateSource(context: SourceReplaceContext, filePath: string, source: SourceContent) {
  assertOwner(context);
  const current = currentSource(context, filePath);
  if (source.buffer?.readOnly || current?.readOnly) throw new Error(`${filePath} is read-only.`);
  if (source.buffer?.isVirtual || current?.isVirtual)
    throw new Error(`${filePath} is not an editable source file.`);
  if (source.buffer && !current)
    throw new Error(
      `${filePath} was closed while preparing the replacement. Search again before replacing.`,
    );
  if (
    source.buffer
      ? !current ||
        current.id !== source.buffer.id ||
        current.path !== source.buffer.path ||
        readBufferRevision(current) !== source.revision ||
        readBufferText(current) !== source.content
      : current && (current.isDirty || readBufferText(current) !== source.content)
  )
    throw new Error(
      `${filePath} changed while preparing the replacement. Search again before replacing.`,
    );
}
async function readSource(filePath: string, context: SourceReplaceContext): Promise<SourceContent> {
  assertOwner(context);
  const buffer = context.sources.get(filePath);
  const source = buffer
    ? { buffer, content: readBufferText(buffer), revision: readBufferRevision(buffer) }
    : { content: await getWorkspaceResourceProvider(filePath).readText(filePath) };
  validateSource(context, filePath, source);
  return source;
}
async function writeSource(
  context: SourceReplaceContext,
  filePath: string,
  source: SourceContent,
  content: string,
) {
  validateSource(context, filePath, source);
  const current = currentSource(context, filePath);
  if (current) {
    trackImmediateBufferHistoryChange({
      bufferId: current.id,
      currentContent: readBufferText(current),
      nextContent: content,
      workspaceId: context.workspaceId,
    });
    context.store.getState().actions.updateBufferContent(current.id, content, true);
    return;
  }
  await getWorkspaceResourceProvider(filePath).writeText(filePath, content, source.content);
  const opened = isBufferStoreOwnerLive(context) ? currentSource(context, filePath) : undefined;
  if (
    opened &&
    !opened.isVirtual &&
    (opened.savedContent === source.content || opened.savedContent === content)
  ) {
    if (!opened.readOnly && !opened.isDirty && readBufferText(opened) === source.content)
      context.store.getState().actions.updateBufferContent(opened.id, content, false);
    context.store.getState().actions.markBufferSaved(opened.id, content);
  }
  emitGitChanged({ filePath, scopes: ["working-tree"], source: "external-file-change" });
}
function buildReplacementRegex(query: string, options: ContentSearchOptions) {
  const regex = buildSearchRegex(query, options);
  return regex ? new RegExp(regex.source, regex.flags + "m") : null;
}
export function replaceNextInSource(
  target: ReplaceTarget,
  query: string,
  replacement: string,
  options: ContentSearchOptions,
  context = captureSourceReplaceContext(),
): Promise<boolean> {
  return queueReplacement(context, async () => {
    const regex = buildReplacementRegex(query, options);
    if (!regex) {
      if (context.expectedMatches)
        throw new Error("This search expression cannot be used for replacement.");
      return false;
    }

    const source = await readSource(target.filePath, context);
    const worker = createSearchWorkerSession({
      signal: context.signal,
      isCancelled: () => !isBufferStoreOwnerLive(context) || context.isCurrent?.() === false,
    });
    let nextContent: string;
    try {
      const result = await worker.run({
        kind: "replace",
        filePath: target.filePath,
        content: source.content,
        pattern: regex.source,
        flags: regex.flags,
        useRegex: options.useRegex,
        replacement,
        target,
        expectedMatches: context.expectedMatches
          ? (context.expectedMatches.get(target.filePath) ?? [])
          : undefined,
      });
      nextContent = result.content;
    } finally {
      worker.dispose();
    }
    validateSource(context, target.filePath, source);
    if (nextContent === source.content) return false;

    await writeSource(context, target.filePath, source, nextContent);
    return true;
  });
}

export function replaceAllInSources(
  filePaths: string[],
  query: string,
  replacement: string,
  options: ContentSearchOptions,
  context = captureSourceReplaceContext(),
): Promise<number> {
  return queueReplacement(context, async () => {
    const regex = buildReplacementRegex(query, options);
    if (!regex) {
      if (context.expectedMatches)
        throw new Error("This search expression cannot be used for replacement.");
      return 0;
    }
    const uniquePaths = [...new Set(filePaths)].filter(Boolean);
    const prepared: Array<
      { filePath: string; source: SourceContent; content: string; count: number } | undefined
    > = Array.from({ length: uniquePaths.length });
    const worker = createSearchWorkerSession({
      signal: context.signal,
      isCancelled: () => !isBufferStoreOwnerLive(context) || context.isCurrent?.() === false,
    });
    let nextFileIndex = 0;
    let preparationFailed = false;
    const prepare = async () => {
      while (nextFileIndex < uniquePaths.length && !preparationFailed) {
        const index = nextFileIndex++;
        const filePath = uniquePaths[index];
        try {
          const source = await readSource(filePath, context);
          const { content, count } = await worker.run({
            kind: "replace",
            filePath,
            content: source.content,
            pattern: regex.source,
            flags: regex.flags,
            useRegex: options.useRegex,
            replacement,
            expectedMatches: context.expectedMatches
              ? (context.expectedMatches.get(filePath) ?? [])
              : undefined,
          });
          validateSource(context, filePath, source);
          if (count && content !== source.content)
            prepared[index] = { filePath, source, content, count };
        } catch (error) {
          preparationFailed = true;
          throw new SourceReplaceFailure(
            error instanceof Error ? error.message : String(error),
            0,
            0,
            filePath,
          );
        }
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(REPLACE_READ_CONCURRENCY, uniquePaths.length) }, prepare),
      );
    } finally {
      worker.dispose();
    }
    const changes = prepared.filter((change) => change !== undefined);
    for (const change of changes) validateSource(context, change.filePath, change.source);
    let replacements = 0;
    let editedFiles = 0;
    for (const change of changes) {
      try {
        await writeSource(context, change.filePath, change.source, change.content);
        replacements += change.count;
        editedFiles++;
      } catch (error) {
        throw new SourceReplaceFailure(
          error instanceof Error ? error.message : String(error),
          replacements,
          editedFiles,
          change.filePath,
        );
      }
    }
    return replacements;
  });
}
