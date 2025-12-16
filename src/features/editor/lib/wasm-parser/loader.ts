/**
 * WASM Parser Loader
 * Handles loading and initializing Tree-sitter WASM parsers
 */

import { Language, Parser, type Query } from "web-tree-sitter";
import { getQueryCdnUrl } from "@/extensions/languages/parser-cdn";
import { logger } from "../../utils/logger";
import { indexedDBParserCache } from "./cache-indexeddb";
import type { LoadedParser, ParserConfig } from "./types";

class WasmParserLoader {
  private static instance: WasmParserLoader;
  private initialized = false;
  private parsers: Map<string, LoadedParser> = new Map();
  private loadingParsers: Map<string, Promise<LoadedParser>> = new Map();

  private constructor() {}

  static getInstance(): WasmParserLoader {
    if (!WasmParserLoader.instance) {
      WasmParserLoader.instance = new WasmParserLoader();
    }
    return WasmParserLoader.instance;
  }

  /**
   * Initialize Tree-sitter WASM
   * Must be called once before loading any parsers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await Parser.init({
        locateFile(scriptName: string) {
          return `/tree-sitter/${scriptName}`;
        },
      });
      this.initialized = true;
      logger.info("WasmParser", "Tree-sitter WASM initialized");
    } catch (error) {
      logger.error("WasmParser", "Failed to initialize Tree-sitter WASM", error);
      throw error;
    }
  }

  /**
   * Check if WASM is initialized and ready to use
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Load a parser for a specific language
   * Returns cached parser if already loaded
   */
  async loadParser(config: ParserConfig): Promise<LoadedParser> {
    const { languageId, highlightQuery } = config;

    // Check if parser is already cached
    if (this.parsers.has(languageId)) {
      const cached = this.parsers.get(languageId)!;

      // If cached parser has no highlight query but new config provides one, update it
      if (!cached.highlightQuery && highlightQuery) {
        logger.info("WasmParser", `Updating cached parser ${languageId} with highlight query`);

        // Create highlight query from text
        try {
          const query = cached.language.query(highlightQuery);
          const updatedParser: LoadedParser = {
            ...cached,
            highlightQuery: query,
          };
          this.parsers.set(languageId, updatedParser);

          // Also update IndexedDB cache with the highlight query
          indexedDBParserCache
            .get(languageId)
            .then((cachedEntry) => {
              if (cachedEntry && !cachedEntry.highlightQuery) {
                indexedDBParserCache.set({
                  ...cachedEntry,
                  highlightQuery,
                });
              }
            })
            .catch(() => {});

          return updatedParser;
        } catch (error) {
          logger.error("WasmParser", `Failed to create highlight query for ${languageId}:`, error);
          // Try to fetch local highlight query as fallback
          const localQuery = await this.fetchLocalHighlightQuery(languageId);
          if (localQuery) {
            try {
              const query = cached.language.query(localQuery);
              const updatedParser: LoadedParser = {
                ...cached,
                highlightQuery: query,
              };
              this.parsers.set(languageId, updatedParser);

              // Update IndexedDB cache with the correct local query
              indexedDBParserCache
                .get(languageId)
                .then((cachedEntry) => {
                  if (cachedEntry) {
                    indexedDBParserCache.set({
                      ...cachedEntry,
                      highlightQuery: localQuery,
                    });
                  }
                })
                .catch(() => {});

              logger.info("WasmParser", `Using local highlight query for ${languageId}`);
              return updatedParser;
            } catch (localError) {
              // Both queries failed - grammar mismatch, clear cache and reload
              logger.error(
                "WasmParser",
                `Local highlight query also failed for ${languageId} - clearing cache for re-download`,
                localError,
              );
              await indexedDBParserCache.delete(languageId);
              this.parsers.delete(languageId);
              // Re-attempt loading from scratch
              return this._loadParserInternal(config);
            }
          }
        }
      }

      return cached;
    }

    // Return ongoing loading promise if exists
    if (this.loadingParsers.has(languageId)) {
      return this.loadingParsers.get(languageId)!;
    }

    // Start loading parser
    const loadPromise = this._loadParserInternal(config);
    this.loadingParsers.set(languageId, loadPromise);

    try {
      const loadedParser = await loadPromise;
      this.parsers.set(languageId, loadedParser);
      this.loadingParsers.delete(languageId);
      return loadedParser;
    } catch (error) {
      this.loadingParsers.delete(languageId);
      throw error;
    }
  }

  /**
   * Validate that a string is a valid tree-sitter query (not HTML or other error response)
   */
  private isValidHighlightQuery(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    // Reject HTML responses (common 404 error pages)
    if (text.trimStart().startsWith("<!") || text.trimStart().startsWith("<html")) return false;
    // Valid queries start with comments (;), patterns ([ or (), or string literals (")
    const trimmed = text.trimStart();
    return (
      trimmed.startsWith(";") ||
      trimmed.startsWith("[") ||
      trimmed.startsWith("(") ||
      trimmed.startsWith('"')
    );
  }

  /**
   * Fetch highlight query from CDN or local public directory
   */
  private async fetchLocalHighlightQuery(languageId: string): Promise<string | null> {
    // First try CDN for languages with CDN config
    const cdnUrl = getQueryCdnUrl(languageId);
    if (cdnUrl) {
      try {
        const response = await fetch(cdnUrl);
        if (response.ok) {
          const text = await response.text();
          if (this.isValidHighlightQuery(text)) {
            logger.debug("WasmParser", `Loaded highlight query from CDN for ${languageId}`);
            return text;
          }
          logger.warn("WasmParser", `Invalid highlight query from CDN ${cdnUrl}`);
        }
      } catch {
        logger.debug("WasmParser", `Failed to fetch highlight query from CDN for ${languageId}`);
      }
    }

    // Fall back to local path for languages without CDN config
    const queryFolder =
      languageId === "typescript" || languageId === "javascript" ? "tsx" : languageId;
    const localPath = `/tree-sitter/queries/${queryFolder}/highlights.scm`;
    try {
      const response = await fetch(localPath);
      if (response.ok) {
        const text = await response.text();
        if (this.isValidHighlightQuery(text)) {
          return text;
        }
        logger.warn(
          "WasmParser",
          `Invalid highlight query from ${localPath} (appears to be HTML or empty)`,
        );
      }
    } catch {
      logger.debug("WasmParser", `No local highlight query found at ${localPath}`);
    }
    return null;
  }

  private async _loadParserInternal(config: ParserConfig): Promise<LoadedParser> {
    const { languageId, wasmPath, highlightQuery: rawHighlightQuery } = config;
    // Validate passed highlight query - reject if it looks like HTML
    const highlightQuery =
      rawHighlightQuery && this.isValidHighlightQuery(rawHighlightQuery)
        ? rawHighlightQuery
        : undefined;

    try {
      // Ensure Tree-sitter is initialized
      if (!this.initialized) {
        await this.initialize();
      }

      // Try to load from IndexedDB cache first
      const cached = await indexedDBParserCache.get(languageId);

      let wasmBytes: Uint8Array;
      let queryText = highlightQuery;

      if (cached) {
        logger.info("WasmParser", `Loading ${languageId} from IndexedDB cache`);

        // Prefer ArrayBuffer over Blob (ArrayBuffer avoids WebKit blob issues)
        if (cached.wasmData) {
          wasmBytes = new Uint8Array(cached.wasmData);
          logger.debug("WasmParser", `Using cached ArrayBuffer for ${languageId}`);
        } else if (cached.wasmBlob) {
          // Fallback to Blob for legacy entries
          try {
            const arrayBuffer = await cached.wasmBlob.arrayBuffer();
            wasmBytes = new Uint8Array(arrayBuffer);
            logger.debug("WasmParser", `Using cached Blob for ${languageId}`);
          } catch (blobError) {
            logger.error(
              "WasmParser",
              `Failed to read cached Blob for ${languageId}, will re-download`,
              blobError,
            );
            // Delete corrupted cache entry and re-download
            await indexedDBParserCache.delete(languageId);
            throw new Error(`Cached parser corrupted, please reinstall ${languageId}`);
          }
        } else {
          throw new Error(`Cache entry for ${languageId} has no WASM data`);
        }

        // Validate cached WASM has correct magic number
        if (
          wasmBytes.length < 4 ||
          wasmBytes[0] !== 0x00 ||
          wasmBytes[1] !== 0x61 ||
          wasmBytes[2] !== 0x73 ||
          wasmBytes[3] !== 0x6d
        ) {
          logger.error(
            "WasmParser",
            `Cached WASM for ${languageId} is invalid (size: ${wasmBytes.length}), clearing cache`,
          );
          await indexedDBParserCache.delete(languageId);
          // Recursively call to re-download
          return this._loadParserInternal(config);
        }

        // Use cached highlight query if available, valid, and not empty
        // Prefer cached query over passed parameter if cached is valid
        if (cached.highlightQuery && this.isValidHighlightQuery(cached.highlightQuery)) {
          queryText = cached.highlightQuery;
          logger.debug("WasmParser", `Using cached highlight query for ${languageId}`);
        } else if (cached.highlightQuery && !this.isValidHighlightQuery(cached.highlightQuery)) {
          // Cached query is invalid (e.g., HTML error page), fetch fresh
          logger.warn(
            "WasmParser",
            `Cached highlight query for ${languageId} is invalid, fetching fresh`,
          );
          const freshQuery = await this.fetchLocalHighlightQuery(languageId);
          if (freshQuery) {
            queryText = freshQuery;
            // Update cache with valid query
            await indexedDBParserCache.set({
              ...cached,
              highlightQuery: freshQuery,
            });
          }
        } else if (!queryText) {
          logger.warn(
            "WasmParser",
            `No highlight query available for ${languageId} - syntax highlighting will be disabled`,
          );
        }
      } else {
        logger.info("WasmParser", `Loading parser for ${languageId} from ${wasmPath}`);

        // Check if wasmPath is a URL (starts with http:// or https://)
        const isRemoteUrl = wasmPath.startsWith("http://") || wasmPath.startsWith("https://");

        if (isRemoteUrl) {
          // Download from remote URL
          logger.info("WasmParser", `Downloading ${languageId} from remote: ${wasmPath}`);

          const response = await fetch(wasmPath);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          wasmBytes = new Uint8Array(arrayBuffer);

          // Validate WASM magic number (first 4 bytes should be \0asm)
          if (
            wasmBytes.length < 4 ||
            wasmBytes[0] !== 0x00 ||
            wasmBytes[1] !== 0x61 ||
            wasmBytes[2] !== 0x73 ||
            wasmBytes[3] !== 0x6d
          ) {
            throw new Error(
              `Downloaded file is not valid WASM (size: ${wasmBytes.length}, magic: ${wasmBytes.slice(0, 4)})`,
            );
          }

          logger.info(
            "WasmParser",
            `Downloaded valid WASM for ${languageId} (${wasmBytes.length} bytes)`,
          );

          // Cache for future use
          try {
            await indexedDBParserCache.set({
              languageId,
              wasmBlob: new Blob([wasmBytes as BlobPart]), // Legacy compatibility
              wasmData: wasmBytes.buffer as ArrayBuffer, // Preferred: ArrayBuffer
              highlightQuery: queryText || "",
              version: "1.0.0", // TODO: Get version from manifest
              checksum: "", // TODO: Calculate checksum
              downloadedAt: Date.now(),
              lastUsedAt: Date.now(),
              size: wasmBytes.byteLength,
              sourceUrl: wasmPath,
            });
            logger.info("WasmParser", `Cached ${languageId} to IndexedDB`);
          } catch (cacheError) {
            logger.warn("WasmParser", `Failed to cache ${languageId}:`, cacheError);
            // Continue even if caching fails
          }
        } else {
          // Load from local path
          logger.info("WasmParser", `Loading ${languageId} from local path: ${wasmPath}`);

          const response = await fetch(wasmPath);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          wasmBytes = new Uint8Array(arrayBuffer);

          // Validate WASM magic number
          if (
            wasmBytes.length < 4 ||
            wasmBytes[0] !== 0x00 ||
            wasmBytes[1] !== 0x61 ||
            wasmBytes[2] !== 0x73 ||
            wasmBytes[3] !== 0x6d
          ) {
            throw new Error(
              `Local file is not valid WASM (size: ${wasmBytes.length}, magic: ${wasmBytes.slice(0, 4)})`,
            );
          }

          logger.info(
            "WasmParser",
            `Loaded valid WASM for ${languageId} (${wasmBytes.length} bytes)`,
          );

          // Also fetch highlight query from local path if not provided
          if (!queryText) {
            const localQuery = await this.fetchLocalHighlightQuery(languageId);
            if (localQuery) {
              queryText = localQuery;
              logger.info("WasmParser", `Loaded local highlight query for ${languageId}`);
            }
          }

          // Cache local parsers to IndexedDB for future use
          try {
            await indexedDBParserCache.set({
              languageId,
              wasmBlob: new Blob([wasmBytes as BlobPart]),
              wasmData: wasmBytes.buffer as ArrayBuffer,
              highlightQuery: queryText || "",
              version: "1.0.0",
              checksum: "",
              downloadedAt: Date.now(),
              lastUsedAt: Date.now(),
              size: wasmBytes.byteLength,
              sourceUrl: wasmPath,
            });
            logger.info("WasmParser", `Cached ${languageId} to IndexedDB (from local path)`);
          } catch (cacheError) {
            logger.warn("WasmParser", `Failed to cache ${languageId}:`, cacheError);
          }
        }
      }

      // Create parser instance
      const parser = new Parser();

      // Load language from WASM bytes
      const language = await Language.load(wasmBytes);
      parser.setLanguage(language);

      // Compile highlight query if provided
      let query: Query | undefined;
      if (queryText) {
        try {
          query = language.query(queryText);
        } catch (error) {
          logger.warn("WasmParser", `Failed to compile highlight query for ${languageId}`, error);
          // Try to fetch local highlight query as fallback
          const localQuery = await this.fetchLocalHighlightQuery(languageId);
          if (localQuery && localQuery !== queryText) {
            try {
              query = language.query(localQuery);
              logger.info("WasmParser", `Using local highlight query fallback for ${languageId}`);
              // Update IndexedDB cache with the correct local query
              indexedDBParserCache
                .get(languageId)
                .then((cachedEntry) => {
                  if (cachedEntry) {
                    indexedDBParserCache.set({
                      ...cachedEntry,
                      highlightQuery: localQuery,
                    });
                  }
                })
                .catch(() => {});
            } catch (localError) {
              // Both queries failed - likely grammar mismatch (e.g., cached WASM lacks JSX support)
              // Delete cached WASM and let it re-download on next load
              logger.error(
                "WasmParser",
                `Local highlight query also failed for ${languageId} - possible grammar mismatch, clearing cache`,
                localError,
              );
              await indexedDBParserCache.delete(languageId);
              this.parsers.delete(languageId);
            }
          }
        }
      }

      logger.info("WasmParser", `Successfully loaded parser for ${languageId}`);

      return {
        parser,
        language,
        highlightQuery: query,
        languageId,
      };
    } catch (error) {
      logger.error("WasmParser", `Failed to load parser for ${languageId}`, error);
      throw new Error(`Failed to load parser for ${languageId}: ${error}`);
    }
  }

  /**
   * Check if a parser is loaded
   */
  isLoaded(languageId: string): boolean {
    return this.parsers.has(languageId);
  }

  /**
   * Get a loaded parser (throws if not loaded)
   */
  getParser(languageId: string): LoadedParser {
    const parser = this.parsers.get(languageId);
    if (!parser) {
      throw new Error(`Parser for ${languageId} is not loaded`);
    }
    return parser;
  }

  /**
   * Unload a parser to free memory
   */
  unloadParser(languageId: string): void {
    const parser = this.parsers.get(languageId);
    if (parser) {
      parser.parser.delete();
      this.parsers.delete(languageId);
      logger.info("WasmParser", `Unloaded parser for ${languageId}`);
    }
  }

  /**
   * Clear all loaded parsers
   */
  clear(): void {
    for (const [languageId, parser] of this.parsers) {
      parser.parser.delete();
      logger.info("WasmParser", `Unloaded parser for ${languageId}`);
    }
    this.parsers.clear();
    this.loadingParsers.clear();
  }

  /**
   * Get list of loaded parser language IDs
   */
  getLoadedLanguages(): string[] {
    return Array.from(this.parsers.keys());
  }
}

export const wasmParserLoader = WasmParserLoader.getInstance();
