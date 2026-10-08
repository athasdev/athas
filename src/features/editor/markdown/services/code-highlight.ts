import { yieldToMain } from "@/utils/yield-to-main";
import { highlightCode, type SyntaxSegment } from "@/features/editor/services/syntax-highlight";
import { normalizeCodeFenceLanguage } from "./language-map";

export type CodeHighlightSegment = SyntaxSegment;

const TOKEN_CACHE = new Map<string, CodeHighlightSegment[]>();
const TOKEN_REQUESTS = new Map<string, Promise<CodeHighlightSegment[]>>();
const TOKEN_CACHE_LIMIT = 200;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  return normalized;
}

function hashCodeContent(code: string) {
  let first = 2_166_136_261;
  let second = 2_166_136_261;
  for (let index = 0; index < code.length; index++) {
    const value = code.charCodeAt(index);
    first = Math.imul(first ^ value, 16_777_619);
    second = Math.imul(second ^ (value + index), 16_777_619);
  }
  return `${code.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

function cacheSegments(key: string, segments: CodeHighlightSegment[]) {
  TOKEN_CACHE.delete(key);
  TOKEN_CACHE.set(key, segments);
  if (TOKEN_CACHE.size > TOKEN_CACHE_LIMIT) {
    const oldestKey = TOKEN_CACHE.keys().next().value;
    if (oldestKey) TOKEN_CACHE.delete(oldestKey);
  }
}

/** Highlight segments for a code block in a fenced-code language, cached by content. */
export async function getCodeHighlightSegments(
  code: string,
  language: string,
): Promise<CodeHighlightSegment[]> {
  const languageId = resolveHighlightLanguage(language);
  if (!languageId) return [];

  const cacheKey = `${languageId}:${hashCodeContent(code)}`;
  const cached = TOKEN_CACHE.get(cacheKey);
  if (cached) {
    TOKEN_CACHE.delete(cacheKey);
    TOKEN_CACHE.set(cacheKey, cached);
    return cached;
  }

  const pending = TOKEN_REQUESTS.get(cacheKey);
  if (pending) return pending;

  const tokenRequest = highlightCode(code, languageId)
    .then((segments) => {
      cacheSegments(cacheKey, segments);
      return segments;
    })
    .finally(() => {
      TOKEN_REQUESTS.delete(cacheKey);
    });
  TOKEN_REQUESTS.set(cacheKey, tokenRequest);
  return tokenRequest;
}

export function renderHighlightedCodeHtml(code: string, segments: CodeHighlightSegment[]): string {
  return applySegmentsToHtml(code, segments);
}

export async function highlightMarkdownCodeBlocks(html: string): Promise<string> {
  const codeBlockRegex = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g;
  const parts: string[] = [];
  let cursor = 0;
  let deadline = 0;

  for (const match of html.matchAll(codeBlockRegex)) {
    if (performance.now() >= deadline) {
      await yieldToMain();
      deadline = performance.now() + 8;
    }

    const rawCode = match[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const segments = await getCodeHighlightSegments(rawCode, match[1]);
    const replacement = segments.length
      ? `<pre><code class="language-${normalizeCodeFenceLanguage(match[1])}">${renderHighlightedCodeHtml(rawCode, segments)}</code></pre>`
      : match[0];
    parts.push(html.slice(cursor, match.index), replacement);
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) return html;
  parts.push(html.slice(cursor));
  return parts.join("");
}
