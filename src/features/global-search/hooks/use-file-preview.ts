import { useEffect, useRef, useState } from "react";
import type { Token } from "@/features/editor/extensions/types";
import {
  fetchHighlightQuery,
  getDefaultParserWasmUrl,
} from "@/features/editor/lib/wasm-parser/extension-assets";
import { tokenizeCodeWithTree } from "@/features/editor/lib/wasm-parser/tokenizer";
import { getLanguageIdFromPath } from "@/features/editor/utils/language-id";
import { readFileContent } from "@/features/file-system/controllers/file-operations";

interface UseFilePreviewReturn {
  content: string;
  tokens: Token[];
  isLoading: boolean;
  error: string | null;
}

const MAX_PREVIEW_SIZE = 100000;
const MAX_LINES = 500;
const MAX_CACHE_SIZE = 30;

const contentCache = new Map<string, string>();
const tokenCache = new Map<string, Token[]>();
const highlightQueryCache = new Map<string, string>();

const addToContentCache = (key: string, value: string) => {
  if (contentCache.size >= MAX_CACHE_SIZE) {
    const firstKey = contentCache.keys().next().value;
    if (firstKey) contentCache.delete(firstKey);
  }
  contentCache.set(key, value);
};

const addToTokenCache = (key: string, value: Token[]) => {
  if (tokenCache.size >= MAX_CACHE_SIZE) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(key, value);
};

export const useFilePreview = (filePath: string | null): UseFilePreviewReturn => {
  const [content, setContent] = useState("");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!filePath) {
      setContent("");
      setTokens([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const currentRequestId = ++requestIdRef.current;

    const tokenizeAsync = async (path: string, text: string, reqId: number) => {
      const languageId = getLanguageIdFromPath(path);
      if (!languageId) return;

      try {
        const wasmPath = getDefaultParserWasmUrl(languageId);
        let highlightQuery = highlightQueryCache.get(languageId);

        if (!highlightQuery) {
          const resolved = await fetchHighlightQuery(languageId, {
            wasmUrl: wasmPath,
            cacheMode: "no-store",
          });
          highlightQuery = resolved.query || "";
          highlightQueryCache.set(languageId, highlightQuery);
        }

        const result = await tokenizeCodeWithTree(text, languageId, {
          languageId,
          wasmPath,
          highlightQuery,
        });
        if (reqId !== requestIdRef.current) {
          try {
            result.tree.delete();
          } catch {}
          return;
        }

        const fileTokens: Token[] = result.tokens.map((token) => ({
          start: token.startIndex,
          end: token.endIndex,
          token_type: token.type,
          class_name: token.type,
        }));

        try {
          result.tree.delete();
        } catch {}

        addToTokenCache(path, fileTokens);
        setTokens(fileTokens);
      } catch {
        // Silently fail tokenization
      }
    };

    const cachedContent = contentCache.get(filePath);
    const cachedTokens = tokenCache.get(filePath);

    if (cachedContent !== undefined) {
      setContent(cachedContent);
      setTokens(cachedTokens || []);
      setIsLoading(false);
      setError(null);

      if (!cachedTokens) {
        tokenizeAsync(filePath, cachedContent, currentRequestId);
      }
      return;
    }

    setIsLoading(true);
    setError(null);
    setTokens([]);

    const loadContent = async () => {
      try {
        const fileContent = await readFileContent(filePath);

        if (currentRequestId !== requestIdRef.current) return;

        if (fileContent.length > MAX_PREVIEW_SIZE) {
          setError("File too large to preview");
          setContent("");
          return;
        }

        const lines = fileContent.split("\n");
        const limitedContent = lines.slice(0, MAX_LINES).join("\n");
        const isTruncated = lines.length > MAX_LINES;
        const finalContent = isTruncated ? `${limitedContent}\n\n... (truncated)` : limitedContent;

        addToContentCache(filePath, finalContent);
        setContent(finalContent);
        setIsLoading(false);

        tokenizeAsync(filePath, limitedContent, currentRequestId);
      } catch (err) {
        if (currentRequestId !== requestIdRef.current) return;
        setError(`Failed to load: ${err}`);
        setContent("");
        setIsLoading(false);
      }
    };

    loadContent();

    return () => {
      requestIdRef.current++;
    };
  }, [filePath]);

  return { content, tokens, isLoading, error };
};
