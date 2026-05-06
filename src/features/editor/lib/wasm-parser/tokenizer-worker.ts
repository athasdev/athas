/// <reference lib="webworker" />

import type { Node, QueryCapture, Tree } from "web-tree-sitter";
import { logger } from "../../utils/logger";
import { getLanguageAssetConfig } from "./extension-assets";
import { getLanguageOverlayTokens } from "./language-overlays";
import { wasmParserLoader } from "./loader";
import { dedupeHighlightTokens, isIgnoredCapture, mapCaptureToClass } from "./capture-map";
import type { HighlightToken, LoadedParser, ParserConfig } from "./types";
import { calculateEdit, isSimpleEdit } from "../../utils/tree-sitter-edit";

interface WorkerSession {
  bufferId: string;
  languageId: string;
  content: string;
  tree: Tree;
}

interface ViewportRangePayload {
  startLine: number;
  endLine: number;
}

interface InjectionRule {
  parentType: string;
  contentType: string;
  language: string;
}

interface WarmupMessage {
  id: number;
  type: "warmup";
  languages?: string[];
}

interface ResetMessage {
  id: number;
  type: "reset";
  bufferId: string;
}

interface TokenizeMessage {
  id: number;
  type: "tokenize";
  bufferId: string;
  content: string;
  languageId: string;
  wasmPath?: string;
  highlightQueryUrl?: string;
  mode: "full" | "range";
  viewportRange?: ViewportRangePayload;
}

type WorkerRequest = WarmupMessage | ResetMessage | TokenizeMessage;

interface WorkerSuccessResponse {
  id: number;
  ok: true;
  tokens?: HighlightToken[];
  normalizedText?: string;
}

interface WorkerErrorResponse {
  id: number;
  ok: false;
  error: string;
}

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

const sessions = new Map<string, WorkerSession>();

const LANGUAGE_INJECTIONS: Record<string, InjectionRule[]> = {
  angular: [
    { parentType: "script_element", contentType: "raw_text", language: "javascript" },
    { parentType: "style_element", contentType: "raw_text", language: "css" },
  ],
  html: [
    { parentType: "script_element", contentType: "raw_text", language: "javascript" },
    { parentType: "style_element", contentType: "raw_text", language: "css" },
  ],
  svelte: [
    { parentType: "script_element", contentType: "raw_text", language: "javascript" },
    { parentType: "style_element", contentType: "raw_text", language: "css" },
    { parentType: "*", contentType: "raw_text_await", language: "javascript" },
    { parentType: "*", contentType: "raw_text_each", language: "javascript" },
    { parentType: "*", contentType: "raw_text_expr", language: "javascript" },
  ],
  markdown: [{ parentType: "*", contentType: "html_block", language: "html" }],
};

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

function findInjectionNodes(
  rootNode: Node,
  rules: InjectionRule[],
): Array<{ rule: InjectionRule; node: Node; parentNode: Node | null }> {
  const results: Array<{ rule: InjectionRule; node: Node; parentNode: Node | null }> = [];

  function walk(node: Node) {
    for (const rule of rules) {
      if (rule.parentType === "*") {
        if (node.type === rule.contentType) {
          results.push({ rule, node, parentNode: null });
        }
      } else if (node.type === rule.parentType) {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && child.type === rule.contentType) {
            results.push({ rule, node: child, parentNode: node });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(rootNode);
  return results;
}

function resolveInjectedLanguage(
  source: string,
  parentLanguageId: string,
  rule: InjectionRule,
  node: Node,
  parentNode: Node | null,
): string {
  if (rule.parentType !== "script_element" || !parentNode) {
    return rule.language;
  }

  const openingTag = source.slice(parentNode.startIndex, node.startIndex);
  const langMatch = openingTag.match(/\blang\s*=\s*["']([^"']+)["']/i);
  const lang = langMatch?.[1]?.trim().toLowerCase();

  if (!lang) {
    return rule.language;
  }

  if (lang === "ts" || lang === "typescript") {
    return "typescript";
  }

  if (lang === "js" || lang === "javascript") {
    return "javascript";
  }

  if (parentLanguageId === "svelte" && (lang === "tsx" || lang === "jsx")) {
    return lang === "tsx" ? "typescriptreact" : "javascriptreact";
  }

  return rule.language;
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
  languageId: string,
  content: string,
  tree: Tree,
) {
  if (session?.tree && session.tree !== tree) {
    try {
      session.tree.delete();
    } catch {
      // ignore
    }
  }

  return {
    bufferId: session?.bufferId ?? "",
    languageId,
    content,
    tree,
  };
}

async function handleTokenize(message: TokenizeMessage): Promise<WorkerSuccessResponse> {
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

  const injectionRules = LANGUAGE_INJECTIONS[message.languageId];
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

  const nextSession = upsertTree(existing, message.languageId, normalizedContent, tree);
  nextSession.bufferId = message.bufferId;
  sessions.set(message.bufferId, nextSession);

  return {
    id: message.id,
    ok: true,
    tokens,
    normalizedText: normalizedContent,
  };
}

function handleReset(message: ResetMessage): WorkerSuccessResponse {
  const existing = sessions.get(message.bufferId);
  if (existing?.tree) {
    try {
      existing.tree.delete();
    } catch {
      // ignore
    }
  }
  sessions.delete(message.bufferId);
  return { id: message.id, ok: true };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case "warmup":
        await wasmParserLoader.initialize();
        await preloadLanguages(message.languages ?? []);
        (self as DedicatedWorkerGlobalScope).postMessage({
          id: message.id,
          ok: true,
        } satisfies WorkerResponse);
        return;
      case "reset":
        (self as DedicatedWorkerGlobalScope).postMessage(
          handleReset(message) satisfies WorkerResponse,
        );
        return;
      case "tokenize":
        await wasmParserLoader.initialize();
        (self as DedicatedWorkerGlobalScope).postMessage(
          (await handleTokenize(message)) satisfies WorkerResponse,
        );
        return;
    }
  } catch (error) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerErrorResponse);
  }
};
