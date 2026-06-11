import { indexedDBParserCache } from "@/features/editor/lib/wasm-parser/cache-indexeddb";
import {
  fetchHighlightQuery,
  getLanguageAssetConfig,
} from "@/features/editor/lib/wasm-parser/extension-assets";
import { tokenizeCode } from "@/features/editor/lib/wasm-parser/tokenizer";
import type { HighlightToken } from "@/features/editor/types/wasm-parser/wasm-parser.types";
import { normalizeLanguage } from "@/features/editor/markdown/language-map";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function applyTokensToCode(code: string, tokens: HighlightToken[]): string {
  if (tokens.length === 0) return escapeHtml(code);

  const result: string[] = [];
  let lastIndex = 0;

  for (const token of tokens) {
    const start = token.startIndex;
    const end = token.endIndex;
    if (start > code.length || end > code.length) continue;

    if (start > lastIndex) {
      result.push(escapeHtml(code.slice(lastIndex, start)));
    }

    const tokenText = escapeHtml(code.slice(start, end));
    result.push(`<span class="${token.type}">${tokenText}</span>`);
    lastIndex = end;
  }

  if (lastIndex < code.length) {
    result.push(escapeHtml(code.slice(lastIndex)));
  }

  return result.join("");
}

function makeFallbackToken(
  code: string,
  startIndex: number,
  text: string,
  type: string,
): HighlightToken {
  return {
    type,
    startIndex,
    endIndex: startIndex + text.length,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 0 },
  };
}

function fallbackTokensForLanguage(code: string, lang: string): HighlightToken[] {
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

  const patterns = patternsByLanguage[lang];
  if (!patterns) return [];

  const tokens: HighlightToken[] = [];

  for (const [pattern, type] of patterns) {
    for (const match of code.matchAll(pattern)) {
      const start = match.index ?? 0;
      const text = match[0];
      const end = start + text.length;
      const overlaps = tokens.some((token) => start < token.endIndex && end > token.startIndex);
      if (!overlaps) {
        tokens.push(makeFallbackToken(code, start, text, type));
      }
    }
  }

  return tokens.sort((a, b) => a.startIndex - b.startIndex);
}

async function tokenizeForLanguage(code: string, lang: string): Promise<HighlightToken[] | null> {
  try {
    const cached = await indexedDBParserCache.get(lang);
    const assets = getLanguageAssetConfig(lang);
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
        const { query } = await fetchHighlightQuery(lang, {
          wasmUrl: wasmPath,
          queryUrl: highlightQueryUrl,
          cacheMode: "no-store",
        });
        highlightQuery = query || highlightQuery;
      } catch {
        // Ignore fetch errors
      }
    }

    const config = { languageId: lang, wasmPath, highlightQuery, highlightQueryUrl };
    return await tokenizeCode(code, lang, config);
  } catch {
    return null;
  }
}

/**
 * Takes parsed markdown HTML and replaces code blocks with syntax-highlighted versions.
 */
export async function highlightCodeBlock(html: string): Promise<string> {
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

  for (const m of matches) {
    const lang = normalizeLanguage(m.lang);
    if (lang === "plaintext") continue;

    // Unescape HTML entities back to raw code for tokenization
    const rawCode = m.code.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

    const tokens = await tokenizeForLanguage(rawCode, lang);
    const resolvedTokens =
      tokens && tokens.length > 0 ? tokens : fallbackTokensForLanguage(rawCode, lang);
    if (resolvedTokens.length === 0) continue;

    const highlighted = applyTokensToCode(rawCode, resolvedTokens);
    result = result.replace(
      m.full,
      `<pre><code class="language-${lang}">${highlighted}</code></pre>`,
    );
  }

  return result;
}
