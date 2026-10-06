import { useEffect, useMemo, useState } from "react";
import {
  highlightCode,
  highlightCodeIfReady,
  type SyntaxLineToken,
  type SyntaxSegment,
  toLineTokens,
} from "@/features/editor/syntax/syntax-highlight";
import { getLanguageIdFromPath } from "@/features/editor/utils/language-id";
import type { GitDiffLine } from "../types/git.types";

interface ReconstructedContent {
  content: string;
  lineMapping: Map<number, number>;
}

/** The old or new side of the hunk as text, with each text line's index in the diff. */
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

  return { content: contentLines.join("\n"), lineMapping };
}

function addSideTokens(
  target: Map<number, SyntaxLineToken[]>,
  side: ReconstructedContent,
  segments: readonly SyntaxSegment[],
) {
  for (const token of toLineTokens(side.content, segments)) {
    const diffIndex = side.lineMapping.get(token.line);
    if (diffIndex === undefined) continue;
    const lineTokens = target.get(diffIndex) ?? [];
    lineTokens.push(token);
    target.set(diffIndex, lineTokens);
  }
}

function appendHighlightHash(hash: number, value: string) {
  let nextHash = hash;
  for (let index = 0; index < value.length; index++) {
    nextHash = Math.imul(nextHash ^ value.charCodeAt(index), 16_777_619);
  }
  return nextHash >>> 0;
}

export function createDiffHighlightKey(lines: GitDiffLine[], filePath: string) {
  let hash = appendHighlightHash(2_166_136_261, filePath);

  for (const line of lines) {
    hash = appendHighlightHash(hash, line.line_type);
    hash = appendHighlightHash(hash, line.content);
    hash = appendHighlightHash(hash, String(line.old_line_number ?? ""));
    hash = appendHighlightHash(hash, String(line.new_line_number ?? ""));
  }

  return `${filePath}:${lines.length}:${hash.toString(16)}`;
}

/**
 * Tokens per diff line. Each side is highlighted as one piece of code, so constructs that span
 * lines (block comments, template strings) color correctly, then mapped back to diff lines.
 */
export async function highlightDiffLines(
  lines: GitDiffLine[],
  filePath: string,
): Promise<Map<number, SyntaxLineToken[]>> {
  const languageId = getLanguageIdFromPath(filePath);
  const tokenMap = new Map<number, SyntaxLineToken[]>();
  if (!languageId) return tokenMap;

  for (const version of ["old", "new"] as const) {
    const side = reconstructContent(lines, version);
    if (side.content) addSideTokens(tokenMap, side, await highlightCode(side.content, languageId));
  }
  return tokenMap;
}

/** Like `highlightDiffLines`, but only when the file's language has already loaded. */
function highlightDiffLinesIfReady(
  lines: GitDiffLine[],
  filePath: string,
): Map<number, SyntaxLineToken[]> | undefined {
  const languageId = getLanguageIdFromPath(filePath);
  const tokenMap = new Map<number, SyntaxLineToken[]>();
  if (!languageId) return tokenMap;

  for (const version of ["old", "new"] as const) {
    const side = reconstructContent(lines, version);
    if (!side.content) continue;
    const segments = highlightCodeIfReady(side.content, languageId);
    if (!segments) return undefined;
    addSideTokens(tokenMap, side, segments);
  }
  return tokenMap;
}

const NO_TOKENS = new Map<number, SyntaxLineToken[]>();

export function useDiffHighlighting(
  lines: GitDiffLine[],
  filePath: string,
): Map<number, SyntaxLineToken[]> {
  const key = useMemo(() => createDiffHighlightKey(lines, filePath), [filePath, lines]);
  const ready = useMemo(() => highlightDiffLinesIfReady(lines, filePath), [filePath, lines]);
  const [loaded, setLoaded] = useState<{ key: string; tokenMap: Map<number, SyntaxLineToken[]> }>({
    key: "",
    tokenMap: NO_TOKENS,
  });

  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    void highlightDiffLines(lines, filePath).then((tokenMap) => {
      if (!cancelled) setLoaded({ key, tokenMap });
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, key, lines, ready]);

  if (ready) return ready;
  return loaded.key === key ? loaded.tokenMap : NO_TOKENS;
}
