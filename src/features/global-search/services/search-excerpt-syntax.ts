import { getLanguageAssetConfig } from "@/features/editor/lib/wasm-parser/extension-assets";
import { tokenizerWorkerClient } from "@/features/editor/lib/wasm-parser/tokenizer-worker-client";
import { getLanguageIdFromPath } from "@/features/editor/utils/language-id";
import {
  hasLineBasedSyntaxFallback,
  tokenizeLineBasedSyntax,
} from "@/features/editor/utils/line-based-syntax";
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

function getWorkerBufferId(languageId: string, content: string) {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `search-preview:${languageId}:${content.length}:${(hash >>> 0).toString(36)}`;
}

function getCachedTokens(key: string) {
  const cached = tokenCache.get(key);
  if (!cached) return null;

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

function getSearchExcerptLanguage(filePath: string) {
  const languageId = getLanguageIdFromPath(filePath);
  if (!languageId || languageId === "text" || languageId === "plaintext") return null;
  return languageId;
}

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
  if (cached) {
    return { key, tokens: cached, complete: true };
  }

  if (hasLineBasedSyntaxFallback(languageId)) {
    const tokens = cacheTokens(key, tokenizeLineBasedSyntax(content, languageId));
    return { key, tokens, complete: true };
  }

  return { key, tokens: EMPTY_TOKENS, complete: false };
}

export async function loadSearchExcerptTokens(filePath: string, content: string): Promise<Token[]> {
  const snapshot = getSearchExcerptTokenSnapshot(filePath, content);
  if (snapshot.complete) return snapshot.tokens;

  const pending = pendingTokenizations.get(snapshot.key);
  if (pending) return pending;

  const languageId = getSearchExcerptLanguage(filePath);
  if (!languageId) return EMPTY_TOKENS;

  const assets = getLanguageAssetConfig(languageId);
  const tokenization = tokenizerWorkerClient
    .tokenize({
      bufferId: getWorkerBufferId(languageId, content),
      content,
      languageId,
      wasmPath: assets.wasmPath,
      highlightQueryUrl: assets.highlightQueryUrl,
      mode: "full",
    })
    .then((result) =>
      result.tokens.map((token) => ({
        start: token.startIndex,
        end: token.endIndex,
        class_name: token.type,
      })),
    )
    .catch(() => EMPTY_TOKENS)
    .then((tokens) => cacheTokens(snapshot.key, tokens))
    .finally(() => pendingTokenizations.delete(snapshot.key));

  pendingTokenizations.set(snapshot.key, tokenization);
  return tokenization;
}
