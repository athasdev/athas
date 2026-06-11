/// <reference lib="webworker" />

import type { QueryCapture, Tree } from "web-tree-sitter";
import { logger } from "../../utils/logger";
import { getLanguageAssetConfig } from "./extension-assets";
import { getLanguageOverlayTokens } from "./language-overlays";
import { wasmParserLoader } from "./loader";
import { dedupeHighlightTokens, isIgnoredCapture, mapCaptureToClass } from "./capture-map";
import type {
  HighlightToken,
  LoadedParser,
  ParserConfig,
} from "../../types/wasm-parser/wasm-parser.types";
import { calculateEdit, isSimpleEdit } from "../../utils/tree-sitter-edit";
import {
  findInjectionNodes,
  getInjectionRules,
  resolveInjectedLanguage,
} from "./language-injections";
import type {
  TokenizerWorkerRequest,
  TokenizerWorkerResponse,
  ViewportRangePayload,
} from "./worker-protocol";

interface WorkerSession {
  bufferId: string;
  languageId: string;
  content: string;
  tree: Tree;
  lastAccessedAt: number;
}

interface WorkerSuccessResponse {
  id: number;
  ok: true;
  tokens?: HighlightToken[];
  normalizedText?: string;
}

const MAX_CACHED_SESSIONS = 8;
const sessions = new Map<string, WorkerSession>();

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function buildLineStartOffsets(content: string): number[] {
  const normalized = normalizeLineEndings(content);
  const offsets = [0];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

async function getLoadedParser(
  languageId: string,
  assets?: { wasmPath?: string; highlightQueryUrl?: string },
): Promise<LoadedParser> {
  if (wasmParserLoader.isLoaded(languageId)) {
    return wasmParserLoader.getParser(languageId);
  }

  const defaultAssets = getLanguageAssetConfig(languageId);
  const config: ParserConfig = {
    languageId,
    wasmPath: assets?.wasmPath || defaultAssets.wasmPath,
    highlightQueryUrl: assets?.highlightQueryUrl || defaultAssets.highlightQueryUrl,
  };

  return wasmParserLoader.loadParser(config);
}

async function preloadLanguages(languageIds: string[]): Promise<void> {
  if (languageIds.length === 0) return;

  await Promise.allSettled(
    Array.from(new Set(languageIds)).map(async (languageId) => {
      try {
        await getLoadedParser(languageId);
      } catch (error) {
        logger.debug("TokenizerWorker", `Warmup preload failed for ${languageId}`, error);
      }
    }),
  );
}

async function tokenizeEmbeddedContent(
  content: string,
  languageId: string,
): Promise<HighlightToken[]> {
  const loadedParser = await getLoadedParser(languageId);
  const tree = loadedParser.parser.parse(content);

  if (!tree) {
    throw new Error(`Failed to parse embedded ${languageId}`);
  }

  try {
    return loadedParser.highlightQuery
      ? toHighlightTokens(loadedParser.highlightQuery.captures(tree.rootNode))
      : [];
  } finally {
    tree.delete();
  }
}

function toHighlightTokens(captures: QueryCapture[]): HighlightToken[] {
  const tokens: HighlightToken[] = [];

  for (const capture of captures) {
    const { name, node } = capture;
    if (isIgnoredCapture(name)) {
      continue;
    }

    tokens.push({
      type: mapCaptureToClass(name),
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      startPosition: {
        row: node.startPosition.row,
        column: node.startPosition.column,
      },
      endPosition: {
        row: node.endPosition.row,
        column: node.endPosition.column,
      },
    });
  }

  return dedupeHighlightTokens(tokens);
}

function getRangeQueryOptions(content: string, viewportRange?: ViewportRangePayload) {
  if (!viewportRange) return {};

  const normalized = normalizeLineEndings(content);
  const lineOffsets = buildLineStartOffsets(normalized);
  const lastLine = Math.max(0, lineOffsets.length - 1);
  const startLine = Math.max(0, Math.min(viewportRange.startLine, lastLine));
  const endLine = Math.max(startLine, Math.min(viewportRange.endLine, lastLine));
  const endIndex = endLine + 1 < lineOffsets.length ? lineOffsets[endLine + 1] : normalized.length;

  return {
    startPosition: { row: startLine, column: 0 },
    endPosition: { row: endLine, column: Number.MAX_SAFE_INTEGER },
    startIndex: lineOffsets[startLine] ?? 0,
    endIndex,
  };
}

function upsertTree(
  session: WorkerSession | undefined,
  bufferId: string,
  languageId: string,
  content: string,
  tree: Tree,
): WorkerSession {
  if (session?.tree && session.tree !== tree) {
    try {
      session.tree.delete();
    } catch {
      // ignore
    }
  }

  return {
    bufferId,
    languageId,
    content,
    tree,
    lastAccessedAt: Date.now(),
  };
}

function disposeSession(session: WorkerSession) {
  try {
    session.tree.delete();
  } catch {
    // ignore
  }
}

function pruneCachedSessions() {
  if (sessions.size <= MAX_CACHED_SESSIONS) return;

  const overflow = sessions.size - MAX_CACHED_SESSIONS;
  const staleSessions = Array.from(sessions.values())
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
    .slice(0, overflow);

  for (const session of staleSessions) {
    sessions.delete(session.bufferId);
    disposeSession(session);
  }
}

async function handleTokenize(
  message: Extract<TokenizerWorkerRequest, { type: "tokenize" }>,
): Promise<WorkerSuccessResponse> {
  const normalizedContent = normalizeLineEndings(message.content);
  const loadedParser = await getLoadedParser(message.languageId, {
    wasmPath: message.wasmPath,
    highlightQueryUrl: message.highlightQueryUrl,
  });
  const existing = sessions.get(message.bufferId);

  let tree: Tree | null = null;

  if (
    existing &&
    existing.languageId === message.languageId &&
    isSimpleEdit(existing.content, normalizedContent)
  ) {
    const edit = calculateEdit(existing.content, normalizedContent);
    if (edit) {
      try {
        const previousTreeCopy = existing.tree.copy();
        previousTreeCopy.edit(edit);
        tree = loadedParser.parser.parse(normalizedContent, previousTreeCopy);
        previousTreeCopy.delete();
      } catch (error) {
        logger.warn(
          "TokenizerWorker",
          "Incremental worker parse failed, falling back to full",
          error,
        );
      }
    }
  }

  if (!tree) {
    tree = loadedParser.parser.parse(normalizedContent);
  }

  if (!tree) {
    throw new Error(`Failed to parse ${message.languageId}`);
  }

  const query = loadedParser.highlightQuery;
  const tokens = query
    ? toHighlightTokens(
        query.captures(
          tree.rootNode,
          message.mode === "range"
            ? getRangeQueryOptions(normalizedContent, message.viewportRange)
            : {},
        ),
      )
    : [];

  const injectionRules = getInjectionRules(message.languageId);
  if (injectionRules) {
    const injectionNodes = findInjectionNodes(tree.rootNode, injectionRules);

    for (const { rule, node, parentNode } of injectionNodes) {
      try {
        const embeddedContent = normalizedContent.substring(node.startIndex, node.endIndex);
        if (!embeddedContent.trim()) continue;

        const embeddedLanguageId = resolveInjectedLanguage(
          normalizedContent,
          message.languageId,
          rule,
          node,
          parentNode,
        );
        const subTokens = await tokenizeEmbeddedContent(embeddedContent, embeddedLanguageId);
        const startOffset = node.startIndex;
        const startRow = node.startPosition.row;
        const startCol = node.startPosition.column;

        for (const token of subTokens) {
          if (token.startPosition.row === 0) {
            token.startPosition.column += startCol;
          }
          if (token.endPosition.row === 0) {
            token.endPosition.column += startCol;
          }
          token.startPosition.row += startRow;
          token.endPosition.row += startRow;
          token.startIndex += startOffset;
          token.endIndex += startOffset;
        }

        tokens.push(...subTokens);
      } catch (error) {
        logger.warn(
          "TokenizerWorker",
          `Failed to tokenize embedded ${rule.language} in ${message.languageId}`,
          error,
        );
      }
    }
  }

  tokens.push(...getLanguageOverlayTokens(message.languageId, normalizedContent));

  const nextSession = upsertTree(
    existing,
    message.bufferId,
    message.languageId,
    normalizedContent,
    tree,
  );
  sessions.set(message.bufferId, nextSession);
  pruneCachedSessions();

  return {
    id: message.id,
    ok: true,
    tokens,
    normalizedText: normalizedContent,
  };
}

function handleReset(
  message: Extract<TokenizerWorkerRequest, { type: "reset" }>,
): WorkerSuccessResponse {
  const existing = sessions.get(message.bufferId);
  if (existing) {
    disposeSession(existing);
  }
  sessions.delete(message.bufferId);
  return { id: message.id, ok: true };
}

self.onmessage = async (event: MessageEvent<TokenizerWorkerRequest>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case "warmup":
        await wasmParserLoader.initialize();
        await preloadLanguages(message.languages ?? []);
        (self as DedicatedWorkerGlobalScope).postMessage({
          id: message.id,
          ok: true,
        } satisfies TokenizerWorkerResponse);
        return;
      case "reset":
        (self as DedicatedWorkerGlobalScope).postMessage(
          handleReset(message) satisfies TokenizerWorkerResponse,
        );
        return;
      case "tokenize":
        await wasmParserLoader.initialize();
        (self as DedicatedWorkerGlobalScope).postMessage(
          (await handleTokenize(message)) satisfies TokenizerWorkerResponse,
        );
        return;
    }
  } catch (error) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies TokenizerWorkerResponse);
  }
};
