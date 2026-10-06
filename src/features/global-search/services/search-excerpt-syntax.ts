import { highlightCode, highlightCodeIfReady } from "@/features/editor/syntax/syntax-highlight";
import { getLanguageIdFromPath } from "@/features/editor/utils/language-id";
import type { Token } from "@/features/editor/utils/html";

const MAX_TOKEN_CACHE_ENTRIES = 200;
const EMPTY_TOKENS: Token[] = [];
const tokenCache = new Map<string, Token[]>();
const pendingTokenizations = new Map<string, Promise<Token[]>>();

export interface SearchExcerptTokenSnapshot {
  key: string;
  tokens: Token[];
  complete: boolean;
}

function getTokenCacheKey(languageId: string, content: string) {
  return `${languageId}\0${content}`;
}

function getCachedTokens(key: string) {
  const cached = tokenCache.get(key);
  if (cached === undefined) return null;

  tokenCache.delete(key);
  tokenCache.set(key, cached);
  return cached;
}

function cacheTokens(key: string, tokens: Token[]) {
  tokenCache.delete(key);
  tokenCache.set(key, tokens);

  while (tokenCache.size > MAX_TOKEN_CACHE_ENTRIES) {
    const oldestKey = tokenCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    tokenCache.delete(oldestKey);
  }

  return tokens;
}

function toTokens(segments: readonly { start: number; end: number; className: string }[]) {
  return segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    class_name: segment.className,
  }));
}

function getSearchExcerptLanguage(filePath: string) {
  const languageId = getLanguageIdFromPath(filePath);
  if (!languageId || languageId === "text" || languageId === "plaintext") return null;
  return languageId;
}

/**
 * Tokens for a search result excerpt, available right away once its language has loaded; until
 * then the snapshot is incomplete and `loadSearchExcerptTokens` finishes it.
 */
export function getSearchExcerptTokenSnapshot(
  filePath: string,
  content: string,
): SearchExcerptTokenSnapshot {
  const languageId = getSearchExcerptLanguage(filePath);
  if (!languageId) {
    return { key: `text\0${content}`, tokens: EMPTY_TOKENS, complete: true };
  }

  const key = getTokenCacheKey(languageId, content);
  const cached = getCachedTokens(key);
  if (cached) return { key, tokens: cached, complete: true };

  const ready = highlightCodeIfReady(content, languageId);
  if (ready) return { key, tokens: cacheTokens(key, toTokens(ready)), complete: true };

  return { key, tokens: EMPTY_TOKENS, complete: false };
}

export async function loadSearchExcerptTokens(filePath: string, content: string): Promise<Token[]> {
  const snapshot = getSearchExcerptTokenSnapshot(filePath, content);
  if (snapshot.complete) return snapshot.tokens;

  const pending = pendingTokenizations.get(snapshot.key);
  if (pending) return pending;

  const languageId = getSearchExcerptLanguage(filePath);
  if (!languageId) return EMPTY_TOKENS;

  const tokenization = highlightCode(content, languageId)
    .then((segments) => cacheTokens(snapshot.key, toTokens(segments)))
    .finally(() => pendingTokenizations.delete(snapshot.key));

  pendingTokenizations.set(snapshot.key, tokenization);
  return tokenization;
}
