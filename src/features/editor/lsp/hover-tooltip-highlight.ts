import { indexedDBParserCache } from "@/features/editor/lib/wasm-parser/cache-indexeddb";
import {
  fetchHighlightQuery,
  getDefaultParserWasmUrl,
} from "@/features/editor/lib/wasm-parser/extension-assets";
import { tokenizeCode } from "@/features/editor/lib/wasm-parser/tokenizer";
import type { HighlightToken } from "@/features/editor/lib/wasm-parser/types";
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

async function tokenizeForLanguage(code: string, lang: string): Promise<HighlightToken[] | null> {
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
    if (!tokens || tokens.length === 0) continue;

    const highlighted = applyTokensToCode(rawCode, tokens);
    result = result.replace(
      m.full,
      `<pre><code class="language-${lang}">${highlighted}</code></pre>`,
    );
  }

  return result;
}
