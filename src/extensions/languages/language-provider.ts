import type {
  ExtensionContext,
  LanguageExtension,
  Token,
} from "@/features/editor/extensions/types";
import { convertToEditorTokens, tokenizeCode } from "@/features/editor/lib/wasm-parser";
import { indexedDBParserCache } from "@/features/editor/lib/wasm-parser/cache-indexeddb";

// CDN base URL for downloading WASM parsers and highlight queries
const CDN_BASE_URL = import.meta.env.VITE_PARSER_CDN_URL || "https://athas.dev/extensions";

export interface LanguageConfig {
  id: string;
  displayName: string;
  extensions: string[];
  aliases?: string[];
  filenames?: string[];
  description?: string;
  wasmPath?: string;
  highlightQueryPath?: string;
}

export abstract class BaseLanguageProvider implements LanguageExtension {
  readonly id: string;
  readonly displayName: string;
  readonly version: string = "1.0.0";
  readonly category: string = "language";
  readonly languageId: string;
  readonly extensions: string[];
  readonly aliases?: string[];
  readonly filenames?: string[];
  readonly description?: string;
  readonly wasmPath: string;
  readonly highlightQueryPath: string;
  private highlightQuery: string | null = null;

  constructor(config: LanguageConfig) {
    this.languageId = config.id;
    this.id = `language.${config.id}`;
    this.displayName = config.displayName;
    this.extensions = config.extensions;
    this.aliases = config.aliases;
    this.filenames = config.filenames;
    this.description = config.description;
    this.wasmPath = config.wasmPath || `${CDN_BASE_URL}/${config.id}/parser.wasm`;
    this.highlightQueryPath =
      config.highlightQueryPath || `${CDN_BASE_URL}/${config.id}/highlights.scm`;
  }

  async activate(context: ExtensionContext): Promise<void> {
    context.registerLanguage({
      id: this.languageId,
      extensions: this.extensions,
      aliases: this.aliases,
    });

    // Load highlight query
    await this.loadHighlightQuery();
  }

  async deactivate(): Promise<void> {
    // Cleanup if needed
  }

  private async loadHighlightQuery(): Promise<void> {
    try {
      const response = await fetch(this.highlightQueryPath);
      if (response.ok) {
        this.highlightQuery = await response.text();

        // Also update IndexedDB cache with the highlight query
        // This ensures the direct tokenizer path has access to it
        try {
          const cached = await indexedDBParserCache.get(this.languageId);
          if (cached && (!cached.highlightQuery || cached.highlightQuery.trim().length === 0)) {
            await indexedDBParserCache.set({
              ...cached,
              highlightQuery: this.highlightQuery,
            });
            console.log(
              `[LanguageProvider] Updated IndexedDB cache with highlight query for ${this.languageId}`,
            );
          }
        } catch (cacheError) {
          // Ignore cache errors - not critical
          console.debug(
            `[LanguageProvider] Could not update cache for ${this.languageId}:`,
            cacheError,
          );
        }
      } else {
        console.warn(`Failed to load highlight query for ${this.languageId}`);
      }
    } catch (error) {
      console.error(`Error loading highlight query for ${this.languageId}:`, error);
    }
  }

  async getTokens(content: string): Promise<Token[]> {
    try {
      const highlightTokens = await tokenizeCode(content, this.languageId, {
        languageId: this.languageId,
        wasmPath: this.wasmPath,
        highlightQuery: this.highlightQuery || undefined,
      });
      return convertToEditorTokens(highlightTokens);
    } catch (error) {
      console.error(`Failed to tokenize ${this.languageId}:`, error);
      return [];
    }
  }
}
