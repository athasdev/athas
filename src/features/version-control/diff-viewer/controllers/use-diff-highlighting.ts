/**
 * Hook for syntax highlighting diff lines using Tree-sitter WASM tokenizer
 */

import { useEffect, useMemo, useState } from "react";
import { indexedDBParserCache } from "@/features/editor/lib/wasm-parser/cache-indexeddb";
import { tokenizeByLine } from "@/features/editor/lib/wasm-parser/tokenizer";
import type { HighlightToken } from "@/features/editor/lib/wasm-parser/types";
import type { GitDiffLine } from "@/features/version-control/git/types/git";

/**
 * Map file extensions to Tree-sitter language IDs
 */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "c_sharp",
  rb: "ruby",
  php: "php",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  lua: "lua",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  ml: "ocaml",
  mli: "ocaml",
  sol: "solidity",
  zig: "zig",
  vue: "vue",
  erb: "embedded_template",
};

function getExtension(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function getLanguageId(filePath: string): string | null {
  const ext = getExtension(filePath);
  return EXTENSION_TO_LANGUAGE[ext] || null;
}

function getLocalWasmPath(languageId: string): string {
  if (languageId === "typescript" || languageId === "javascript") {
    return "/tree-sitter/parsers/tree-sitter-tsx.wasm";
  }
  return `/tree-sitter/parsers/tree-sitter-${languageId}.wasm`;
}

function getQueryFolder(languageId: string): string {
  if (languageId === "typescript" || languageId === "javascript") {
    return "tsx";
  }
  return languageId;
}

interface ReconstructedContent {
  content: string;
  lineMapping: Map<number, number>; // reconstructedLineIndex -> diffLineIndex
}

/**
 * Reconstruct file content from diff lines
 * @param lines - The diff lines
 * @param version - "old" includes context+removed, "new" includes context+added
 * @returns The reconstructed content and line mapping
 */
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

/**
 * Map tokens from reconstructed content back to diff line indices
 */
function mapTokensToDiffLines(
  tokensByLine: Map<number, HighlightToken[]>,
  lineMapping: Map<number, number>,
): Map<number, HighlightToken[]> {
  const result = new Map<number, HighlightToken[]>();

  for (const [reconstructedLine, tokens] of tokensByLine) {
    const diffIndex = lineMapping.get(reconstructedLine);
    if (diffIndex !== undefined) {
      // Adjust token positions to be relative to the line start
      const adjustedTokens = tokens.map((token) => ({
        ...token,
        // Keep start/end relative to line content
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

/**
 * Hook to provide syntax highlighting tokens for diff lines
 */
export function useDiffHighlighting(
  lines: GitDiffLine[],
  filePath: string,
): Map<number, HighlightToken[]> {
  const [tokenMap, setTokenMap] = useState<Map<number, HighlightToken[]>>(new Map());

  const languageId = useMemo(() => getLanguageId(filePath), [filePath]);

  // Reconstruct old and new content with line mappings
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

    // Capture non-null value for use in async function
    const lang = languageId;
    let cancelled = false;

    async function tokenize() {
      try {
        // Check IndexedDB cache for parser config
        const cached = await indexedDBParserCache.get(lang);

        let wasmPath = getLocalWasmPath(lang);
        let highlightQuery: string | undefined;

        if (cached) {
          wasmPath = cached.sourceUrl || wasmPath;
          highlightQuery = cached.highlightQuery;
        }

        // Load highlight query if not cached
        if (!highlightQuery || highlightQuery.trim().length === 0) {
          const queryFolder = getQueryFolder(lang);
          const queryPath = `/tree-sitter/queries/${queryFolder}/highlights.scm`;
          try {
            const response = await fetch(queryPath);
            if (response.ok) {
              highlightQuery = await response.text();
            }
          } catch {
            // Ignore fetch errors
          }
        }

        const config = { languageId: lang, wasmPath, highlightQuery };

        // Tokenize both versions in parallel
        const [oldTokensByLine, newTokensByLine] = await Promise.all([
          oldContent.content
            ? tokenizeByLine(oldContent.content, lang, config)
            : Promise.resolve(new Map<number, HighlightToken[]>()),
          newContent.content
            ? tokenizeByLine(newContent.content, lang, config)
            : Promise.resolve(new Map<number, HighlightToken[]>()),
        ]);

        if (cancelled) return;

        // Map tokens back to diff line indices
        const oldTokenMap = mapTokensToDiffLines(oldTokensByLine, oldContent.lineMapping);
        const newTokenMap = mapTokensToDiffLines(newTokensByLine, newContent.lineMapping);

        // Merge both maps (old has removed lines, new has added lines, both have context)
        const merged = new Map<number, HighlightToken[]>();

        for (const [index, tokens] of oldTokenMap) {
          merged.set(index, tokens);
        }
        for (const [index, tokens] of newTokenMap) {
          // For context lines, both versions should have the same tokens
          // Prefer new version tokens as they might be more accurate
          merged.set(index, tokens);
        }

        setTokenMap(merged);
      } catch {
        // Silently fail - diff will show without highlighting
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
