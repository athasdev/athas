import { useEffect, useMemo, useState } from "react";
import { indexedDBParserCache } from "@/features/editor/lib/wasm-parser/cache-indexeddb";
import {
  fetchHighlightQuery,
  getDefaultParserWasmUrl,
} from "@/features/editor/lib/wasm-parser/extension-assets";
import { tokenizeByLine } from "@/features/editor/lib/wasm-parser/tokenizer";
import type { HighlightToken } from "@/features/editor/types/wasm-parser/wasm-parser.types";
import { buildLineOffsetMap } from "@/features/editor/utils/html";
import { getLanguageIdFromPath } from "@/features/editor/utils/language-id";
import {
  hasLineBasedSyntaxFallback,
  tokenizeLineBasedSyntax,
} from "@/features/editor/utils/line-based-syntax";
import type { GitDiffLine } from "../types/git.types";

function getLanguageId(filePath: string): string | null {
  return getLanguageIdFromPath(filePath);
}

interface ReconstructedContent {
  content: string;
  lineMapping: Map<number, number>;
}

function reconstructContent(lines: GitDiffLine[], version: "old" | "new"): ReconstructedContent {
  const contentLines: string[] = [];
  const lineMapping = new Map<number, number>();

  lines.forEach((line, diffIndex) => {
    if (line.line_type === "header") return;

    const includeInOld = line.line_type === "context" || line.line_type === "removed";
    const includeInNew = line.line_type === "context" || line.line_type === "added";

    if ((version === "old" && includeInOld) || (version === "new" && includeInNew)) {
      lineMapping.set(contentLines.length, diffIndex);
      contentLines.push(line.content);
    }
  });

  return {
    content: contentLines.join("\n"),
    lineMapping,
  };
}

function mapTokensToDiffLines(
  tokensByLine: Map<number, HighlightToken[]>,
  lineMapping: Map<number, number>,
): Map<number, HighlightToken[]> {
  const result = new Map<number, HighlightToken[]>();

  for (const [reconstructedLine, tokens] of tokensByLine) {
    const diffIndex = lineMapping.get(reconstructedLine);
    if (diffIndex !== undefined) {
      const adjustedTokens = tokens.map((token) => ({
        ...token,
        startPosition: {
          row: 0,
          column: token.startPosition.column,
        },
        endPosition: {
          row: token.endPosition.row - token.startPosition.row,
          column: token.endPosition.column,
        },
      }));
      result.set(diffIndex, adjustedTokens);
    }
  }

  return result;
}

function findLineIndexForOffset(lineOffsets: number[], offset: number): number {
  let low = 0;
  let high = Math.max(0, lineOffsets.length - 1);
  let line = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineOffset = lineOffsets[mid] ?? 0;

    if (lineOffset <= offset) {
      line = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return line;
}

function tokenizeLineBasedContentByLine(
  content: string,
  languageId: string,
): Map<number, HighlightToken[]> {
  const tokens = tokenizeLineBasedSyntax(content, languageId);
  if (tokens.length === 0) return new Map();

  const lineOffsets = buildLineOffsetMap(content);
  const tokensByLine = new Map<number, HighlightToken[]>();

  for (const token of tokens) {
    const line = findLineIndexForOffset(lineOffsets, token.start);
    const lineStart = lineOffsets[line] ?? 0;
    const nextLineStart = lineOffsets[line + 1];
    const lineEnd =
      nextLineStart === undefined ? content.length : Math.max(lineStart, nextLineStart - 1);
    const startColumn = Math.max(0, token.start - lineStart);
    const endColumn = Math.min(lineEnd - lineStart, token.end - lineStart);

    if (endColumn <= startColumn) continue;

    const lineTokens = tokensByLine.get(line) ?? [];
    lineTokens.push({
      type: token.class_name,
      startIndex: token.start,
      endIndex: token.end,
      startPosition: { row: line, column: startColumn },
      endPosition: { row: line, column: endColumn },
    });
    tokensByLine.set(line, lineTokens);
  }

  return tokensByLine;
}

export function createLineBasedDiffTokenMap(
  lines: GitDiffLine[],
  filePath: string,
): Map<number, HighlightToken[]> {
  const languageId = getLanguageId(filePath);
  if (!languageId || !hasLineBasedSyntaxFallback(languageId)) return new Map();

  const oldContent = reconstructContent(lines, "old");
  const newContent = reconstructContent(lines, "new");
  const oldTokensByLine = tokenizeLineBasedContentByLine(oldContent.content, languageId);
  const newTokensByLine = tokenizeLineBasedContentByLine(newContent.content, languageId);
  const oldTokenMap = mapTokensToDiffLines(oldTokensByLine, oldContent.lineMapping);
  const newTokenMap = mapTokensToDiffLines(newTokensByLine, newContent.lineMapping);
  const merged = new Map<number, HighlightToken[]>();

  for (const [index, tokens] of oldTokenMap) {
    merged.set(index, tokens);
  }
  for (const [index, tokens] of newTokenMap) {
    merged.set(index, tokens);
  }

  return merged;
}

interface DiffTokenState {
  key: string;
  tokenMap: Map<number, HighlightToken[]>;
}

export function useDiffHighlighting(
  lines: GitDiffLine[],
  filePath: string,
): Map<number, HighlightToken[]> {
  const languageId = useMemo(() => getLanguageId(filePath), [filePath]);
  const highlightKey = useMemo(
    () =>
      `${filePath}:${languageId ?? ""}:${lines.length}:${lines[0]?.content ?? ""}:${
        lines[lines.length - 1]?.content ?? ""
      }`,
    [filePath, languageId, lines],
  );

  const { oldContent, newContent } = useMemo(() => {
    const old = reconstructContent(lines, "old");
    const newC = reconstructContent(lines, "new");
    return { oldContent: old, newContent: newC };
  }, [lines]);
  const fallbackTokenMap = useMemo(
    () => createLineBasedDiffTokenMap(lines, filePath),
    [lines, filePath],
  );
  const [tokenState, setTokenState] = useState<DiffTokenState>({
    key: "",
    tokenMap: new Map(),
  });

  useEffect(() => {
    if (!languageId) {
      setTokenState({ key: highlightKey, tokenMap: new Map() });
      return;
    }

    const lang = languageId;
    let cancelled = false;
    setTokenState({ key: highlightKey, tokenMap: fallbackTokenMap });

    async function tokenize() {
      try {
        const cached = await indexedDBParserCache.get(lang);

        let wasmPath = getDefaultParserWasmUrl(lang);
        let highlightQuery: string | undefined;

        if (cached) {
          wasmPath = cached.sourceUrl || wasmPath;
          highlightQuery = cached.highlightQuery;
        }

        if (!highlightQuery || highlightQuery.trim().length === 0) {
          try {
            const { query } = await fetchHighlightQuery(lang, {
              wasmUrl: wasmPath,
              cacheMode: "no-store",
            });
            highlightQuery = query || highlightQuery;
          } catch {
            // Ignore fetch errors
          }
        }

        const config = { languageId: lang, wasmPath, highlightQuery };

        const [oldTokensByLine, newTokensByLine] = await Promise.all([
          oldContent.content
            ? tokenizeByLine(oldContent.content, lang, config)
            : Promise.resolve(new Map<number, HighlightToken[]>()),
          newContent.content
            ? tokenizeByLine(newContent.content, lang, config)
            : Promise.resolve(new Map<number, HighlightToken[]>()),
        ]);

        if (cancelled) return;

        const oldTokenMap = mapTokensToDiffLines(oldTokensByLine, oldContent.lineMapping);
        const newTokenMap = mapTokensToDiffLines(newTokensByLine, newContent.lineMapping);

        const merged = new Map<number, HighlightToken[]>();

        for (const [index, tokens] of oldTokenMap) {
          merged.set(index, tokens);
        }
        for (const [index, tokens] of newTokenMap) {
          merged.set(index, tokens);
        }

        setTokenState({
          key: highlightKey,
          tokenMap: merged.size > 0 ? merged : fallbackTokenMap,
        });
      } catch {
        setTokenState({ key: highlightKey, tokenMap: fallbackTokenMap });
      }
    }

    tokenize();

    return () => {
      cancelled = true;
    };
  }, [fallbackTokenMap, highlightKey, languageId, oldContent, newContent]);

  return tokenState.key === highlightKey ? tokenState.tokenMap : fallbackTokenMap;
}
