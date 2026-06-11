import { indexedDBParserCache } from "@/features/editor/lib/wasm-parser/cache-indexeddb";
import {
  fetchHighlightQuery,
  getLanguageAssetConfig,
} from "@/features/editor/lib/wasm-parser/extension-assets";
import { tokenizeCode } from "@/features/editor/lib/wasm-parser/tokenizer";
import type { HighlightToken } from "@/features/editor/types/wasm-parser/wasm-parser.types";
import { normalizeCodeFenceLanguage } from "./language-map";

export interface CodeHighlightSegment {
  start: number;
  end: number;
  className: string;
}

const TOKEN_CACHE = new Map<string, CodeHighlightSegment[]>();

const TREE_SITTER_LANGUAGE_ALIASES: Record<string, string> = {
  csharp: "csharp",
  jsx: "tsx",
  shell: "bash",
  markup: "html",
  xml: "html",
  objectivec: "objc",
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeSegments(
  tokens: CodeHighlightSegment[],
  maxLength: number,
): CodeHighlightSegment[] {
  if (tokens.length === 0) return [];

  const sorted = [...tokens].sort((a, b) => a.start - b.start || a.end - b.end);
  const normalized: CodeHighlightSegment[] = [];
  let cursor = 0;

  for (const token of sorted) {
    const start = Math.max(0, Math.min(maxLength, token.start));
    const end = Math.max(0, Math.min(maxLength, token.end));
    if (end <= start) continue;

    const clampedStart = Math.max(start, cursor);
    if (end <= clampedStart) continue;

    normalized.push({
      ...token,
      start: clampedStart,
      end,
    });

    cursor = end;
  }

  return normalized;
}

function applySegmentsToHtml(code: string, segments: CodeHighlightSegment[]): string {
  if (segments.length === 0) return escapeHtml(code);

  const result: string[] = [];
  let lastIndex = 0;

  for (const segment of segments) {
    if (segment.start > lastIndex) {
      result.push(escapeHtml(code.slice(lastIndex, segment.start)));
    }

    const tokenText = escapeHtml(code.slice(segment.start, segment.end));
    result.push(`<span class="${segment.className}">${tokenText}</span>`);
    lastIndex = segment.end;
  }

  if (lastIndex < code.length) {
    result.push(escapeHtml(code.slice(lastIndex)));
  }

  return result.join("");
}

function makeFallbackToken(start: number, text: string, className: string): CodeHighlightSegment {
  return {
    start,
    end: start + text.length,
    className,
  };
}

function fallbackSegmentsForLanguage(code: string, languageId: string): CodeHighlightSegment[] {
  const patternsByLanguage: Record<string, Array<[RegExp, string]>> = {
    python: [
      [/#.*$/gm, "token-comment"],
      [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g, "token-string"],
      [
        /\b(import|from|as|def|class|return|if|elif|else|for|while|with|lambda|try|except|finally|raise|in|is|and|or|not)\b/g,
        "token-keyword",
      ],
      [/\b(True|False|None)\b/g, "token-constant"],
      [/\b\d+(\.\d+)?\b/g, "token-number"],
      [/\b[A-Za-z_][\w]*(?=\s*\()/g, "token-function"],
    ],
    r: [
      [/#.*$/gm, "token-comment"],
      [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g, "token-string"],
      [
        /\b(function|if|else|for|while|repeat|in|next|break|TRUE|FALSE|NULL|NA)\b/g,
        "token-keyword",
      ],
      [/\b\d+(\.\d+)?\b/g, "token-number"],
      [/\b[A-Za-z.][\w.]*(?=\s*\()/g, "token-function"],
      [/(<-|->|=>|>=|<=|==|!=|\|>|\+|-|\*|\/|~)/g, "token-operator"],
    ],
    sql: [
      [/--.*$/gm, "token-comment"],
      [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g, "token-string"],
      [
        /\b(select|from|where|join|left|right|inner|outer|on|group|by|order|having|limit|as|and|or|not|null|insert|update|delete|create|table|view|with|case|when|then|else|end)\b/gi,
        "token-keyword",
      ],
      [/\b(avg|count|sum|min|max|coalesce|cast|round)\s*(?=\()/gi, "token-function"],
      [/\b\d+(\.\d+)?\b/g, "token-number"],
    ],
  };

  const patterns = patternsByLanguage[languageId];
  if (!patterns) return [];

  const tokens: CodeHighlightSegment[] = [];

  for (const [pattern, className] of patterns) {
    for (const match of code.matchAll(pattern)) {
      const start = match.index ?? 0;
      const text = match[0];
      const end = start + text.length;
      const overlaps = tokens.some((token) => start < token.end && end > token.start);
      if (!overlaps) {
        tokens.push(makeFallbackToken(start, text, className));
      }
    }
  }

  return normalizeSegments(tokens, code.length);
}

function resolveHighlightLanguage(language: string): string | null {
  const normalized = normalizeCodeFenceLanguage(language);
  if (
    !normalized ||
    normalized === "plaintext" ||
    normalized === "text" ||
    normalized === "clike"
  ) {
    return null;
  }
  return TREE_SITTER_LANGUAGE_ALIASES[normalized] || normalized;
}

async function tokenizeForLanguage(
  code: string,
  languageId: string,
): Promise<CodeHighlightSegment[] | null> {
  try {
    const cached = await indexedDBParserCache.get(languageId);
    const assets = getLanguageAssetConfig(languageId);
    let wasmPath = assets.wasmPath;
    let highlightQuery: string | undefined;
    let highlightQueryUrl = assets.highlightQueryUrl;

    if (cached) {
      wasmPath = cached.sourceUrl || wasmPath;
      highlightQuery = cached.highlightQuery;
      highlightQueryUrl =
        highlightQueryUrl || cached.sourceUrl?.replace(/parser\.wasm$/, "highlights.scm") || "";
    }

    if (!highlightQuery || highlightQuery.trim().length === 0) {
      try {
        const { query } = await fetchHighlightQuery(languageId, {
          wasmUrl: wasmPath,
          queryUrl: highlightQueryUrl,
          cacheMode: "no-store",
        });
        highlightQuery = query || highlightQuery;
      } catch {}
    }

    const tokens = await tokenizeCode(code, languageId, {
      languageId,
      wasmPath,
      highlightQuery,
      highlightQueryUrl,
    });

    return normalizeSegments(
      tokens.map((token: HighlightToken) => ({
        start: token.startIndex,
        end: token.endIndex,
        className: token.type,
      })),
      code.length,
    );
  } catch {
    return null;
  }
}

export async function getCodeHighlightSegments(
  code: string,
  language: string,
): Promise<CodeHighlightSegment[]> {
  const languageId = resolveHighlightLanguage(language);
  if (!languageId) return [];

  const cacheKey = `${languageId}:${code}`;
  const cached = TOKEN_CACHE.get(cacheKey);
  if (cached) return cached;

  const treeSitterSegments = await tokenizeForLanguage(code, languageId);
  const segments =
    treeSitterSegments && treeSitterSegments.length > 0
      ? treeSitterSegments
      : fallbackSegmentsForLanguage(code, languageId);

  TOKEN_CACHE.set(cacheKey, segments);
  return segments;
}

export function renderHighlightedCodeHtml(code: string, segments: CodeHighlightSegment[]): string {
  return applySegmentsToHtml(code, segments);
}

export async function highlightMarkdownCodeBlocks(html: string): Promise<string> {
  const codeBlockRegex = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g;
  const matches: { full: string; lang: string; code: string }[] = [];

  for (const match of html.matchAll(codeBlockRegex)) {
    matches.push({
      full: match[0],
      lang: match[1],
      code: match[2],
    });
  }

  if (matches.length === 0) return html;

  let result = html;

  for (const match of matches) {
    const rawCode = match.code.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const segments = await getCodeHighlightSegments(rawCode, match.lang);
    if (segments.length === 0) continue;

    const highlighted = renderHighlightedCodeHtml(rawCode, segments);
    const languageId = normalizeCodeFenceLanguage(match.lang);
    result = result.replace(
      match.full,
      `<pre><code class="language-${languageId}">${highlighted}</code></pre>`,
    );
  }

  return result;
}
