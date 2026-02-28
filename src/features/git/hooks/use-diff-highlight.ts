import { useEffect, useMemo, useState } from "react";
import { indexedDBParserCache } from "@/features/editor/lib/wasm-parser/cache-indexeddb";
import {
  fetchHighlightQuery,
  getDefaultParserWasmUrl,
} from "@/features/editor/lib/wasm-parser/extension-assets";
import { tokenizeByLine } from "@/features/editor/lib/wasm-parser/tokenizer";
import type { HighlightToken } from "@/features/editor/lib/wasm-parser/types";
import { getLanguageIdFromPath } from "@/features/editor/utils/language-id";
import type { GitDiffLine } from "../types/git";

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

export function useDiffHighlighting(
  lines: GitDiffLine[],
  filePath: string,
): Map<number, HighlightToken[]> {
  const [tokenMap, setTokenMap] = useState<Map<number, HighlightToken[]>>(new Map());

  const languageId = useMemo(() => getLanguageId(filePath), [filePath]);

  const { oldContent, newContent } = useMemo(() => {
    const old = reconstructContent(lines, "old");
    const newC = reconstructContent(lines, "new");
    return { oldContent: old, newContent: newC };
  }, [lines]);

  useEffect(() => {
    if (!languageId) {
      setTokenMap(new Map());
      return;
    }

    const lang = languageId;
    let cancelled = false;

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

        setTokenMap(merged);
      } catch {
        setTokenMap(new Map());
      }
    }

    tokenize();

    return () => {
      cancelled = true;
    };
  }, [languageId, oldContent, newContent]);

  return tokenMap;
}
