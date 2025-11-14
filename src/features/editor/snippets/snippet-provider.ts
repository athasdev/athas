import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { logger } from "@/features/editor/utils/logger";
import type { Snippet } from "./types";

/**
 * Get all snippets for a specific language
 */
export function getSnippetsForLanguage(languageId: string): Snippet[] {
  try {
    const extensionSnippets = extensionRegistry.getSnippetsForLanguage(languageId);

    return extensionSnippets.map((snippet) => ({
      ...snippet,
      language: languageId,
    }));
  } catch (error) {
    logger.error("SnippetProvider", `Failed to load snippets for ${languageId}:`, error);
    return [];
  }
}

/**
 * Get snippets that match a given prefix
 */
export function getSnippetsByPrefix(prefix: string, languageId: string): Snippet[] {
  const snippets = getSnippetsForLanguage(languageId);

  return snippets.filter((snippet) =>
    snippet.prefix.toLowerCase().startsWith(prefix.toLowerCase()),
  );
}

/**
 * Get all available snippets across all languages
 */
export function getAllSnippets(): Snippet[] {
  try {
    return extensionRegistry.getAllSnippets();
  } catch (error) {
    logger.error("SnippetProvider", "Failed to load all snippets:", error);
    return [];
  }
}

/**
 * Convert snippets to completion items
 */
export function snippetsToCompletionItems(snippets: Snippet[]): Array<{
  label: string;
  detail?: string;
  kind: string;
  insertText: string;
  isSnippet: true;
  snippet: Snippet;
}> {
  return snippets.map((snippet) => ({
    label: snippet.prefix,
    detail: snippet.description || "Snippet",
    kind: "Snippet",
    insertText: Array.isArray(snippet.body) ? snippet.body.join("\n") : snippet.body,
    isSnippet: true as const,
    snippet,
  }));
}
