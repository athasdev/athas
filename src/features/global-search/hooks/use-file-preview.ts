import { useEffect, useState } from "react";
import { extensionManager } from "@/features/editor/extensions/manager";
import type { Token } from "@/features/editor/extensions/types";
import { readFileContent } from "@/features/file-system/controllers/file-operations";

interface UseFilePreviewReturn {
  content: string;
  tokens: Token[];
  isLoading: boolean;
  error: string | null;
}

const MAX_PREVIEW_SIZE = 100000; // 100KB limit for preview
const MAX_LINES = 500; // Maximum number of lines to show

interface CachedPreview {
  content: string;
  tokens: Token[];
  error: string | null;
}

// Cache to store previously loaded previews
const previewCache = new Map<string, CachedPreview>();

export const useFilePreview = (filePath: string | null): UseFilePreviewReturn => {
  const [content, setContent] = useState("");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setContent("");
      setTokens([]);
      setError(null);
      return;
    }

    // Check cache first
    const cached = previewCache.get(filePath);
    if (cached) {
      setContent(cached.content);
      setTokens(cached.tokens);
      setError(cached.error);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const loadPreview = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const fileContent = await readFileContent(filePath);

        if (isCancelled) return;

        // Check file size
        if (fileContent.length > MAX_PREVIEW_SIZE) {
          const errorMsg = "File too large to preview";
          setError(errorMsg);
          setContent("");
          setTokens([]);
          previewCache.set(filePath, { content: "", tokens: [], error: errorMsg });
          return;
        }

        // Limit to first N lines
        const lines = fileContent.split("\n");
        const limitedContent = lines.slice(0, MAX_LINES).join("\n");
        const isTruncated = lines.length > MAX_LINES;

        const finalContent = isTruncated ? `${limitedContent}\n\n... (truncated)` : limitedContent;
        setContent(finalContent);

        // Get syntax tokens (with lazy loading)
        const extension = filePath.split(".").pop() || "txt";
        const languageProvider = await extensionManager.ensureLanguageProvider(extension);

        let fileTokens: Token[] = [];
        if (languageProvider) {
          try {
            fileTokens = await languageProvider.getTokens(limitedContent);
          } catch (error) {
            console.warn(`Failed to tokenize with ${extension}:`, error);
          }
        }

        if (isCancelled) return;

        setTokens(fileTokens);

        // Cache the result
        previewCache.set(filePath, { content: finalContent, tokens: fileTokens, error: null });
      } catch (err) {
        if (isCancelled) return;
        const errorMsg = `Failed to load preview: ${err}`;
        setError(errorMsg);
        setContent("");
        setTokens([]);
        previewCache.set(filePath, { content: "", tokens: [], error: errorMsg });
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPreview();

    return () => {
      isCancelled = true;
    };
  }, [filePath]);

  return { content, tokens, isLoading, error };
};
