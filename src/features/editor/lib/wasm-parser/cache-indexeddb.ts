/**
 * IndexedDB Cache for Tree-sitter WASM Parsers
 * Provides persistent storage for downloaded language parsers
 */

import { logger } from "@/features/editor/utils/logger";

const DB_NAME = "athas-parser-cache";
const DB_VERSION = 1;
const STORE_NAME = "parsers";

export interface ParserCacheEntry {
  languageId: string; // Primary key
  extensionId?: string; // Full extension ID from manifest (e.g., "language.typescript")
  wasmBlob: Blob; // Legacy: Raw WASM bytes as Blob (deprecated, use wasmData)
  wasmData?: ArrayBuffer; // Raw WASM bytes as ArrayBuffer (preferred)
  highlightQuery: string; // Highlight query text
  version: string; // Parser version
  checksum: string; // SHA-256 hash
  downloadedAt: number; // Timestamp
  lastUsedAt: number; // For LRU tracking
  size: number; // File size in bytes
  sourceUrl: string; // Original download URL
}

export interface CacheStats {
  totalSize: number;
  parserCount: number;
  parsers: Array<{
    languageId: string;
    size: number;
    version: string;
    downloadedAt: number;
  }>;
}

class IndexedDBParserCache {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the IndexedDB connection
   */
  async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        logger.error("ParserCache", "Failed to open IndexedDB:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        logger.info("ParserCache", "IndexedDB initialized successfully");
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "languageId" });

          // Create indexes for querying
          store.createIndex("version", "version", { unique: false });
          store.createIndex("downloadedAt", "downloadedAt", { unique: false });
          store.createIndex("lastUsedAt", "lastUsedAt", { unique: false });
          store.createIndex("size", "size", { unique: false });

          logger.info("ParserCache", "Created parser cache object store");
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Get a parser from the cache
   */
  async get(languageId: string): Promise<ParserCacheEntry | null> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(languageId);

      request.onerror = () => {
        logger.error("ParserCache", `Failed to get parser ${languageId}:`, request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        const entry = request.result as ParserCacheEntry | undefined;

        if (entry) {
          // Update last used timestamp
          entry.lastUsedAt = Date.now();
          store.put(entry);

          logger.debug("ParserCache", `Retrieved parser ${languageId} from cache`);
          resolve(entry);
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * Store a parser in the cache
   */
  async set(entry: ParserCacheEntry): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      // Ensure timestamps are set
      entry.lastUsedAt = entry.lastUsedAt || Date.now();
      entry.downloadedAt = entry.downloadedAt || Date.now();

      const request = store.put(entry);

      request.onerror = () => {
        logger.error("ParserCache", `Failed to store parser ${entry.languageId}:`, request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        logger.info(
          "ParserCache",
          `Stored parser ${entry.languageId} (${(entry.size / 1024).toFixed(1)} KB)`,
        );
        resolve();
      };
    });
  }

  /**
   * Delete a parser from the cache
   */
  async delete(languageId: string): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(languageId);

      request.onerror = () => {
        logger.error("ParserCache", `Failed to delete parser ${languageId}:`, request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        logger.info("ParserCache", `Deleted parser ${languageId} from cache`);
        resolve();
      };
    });
  }

  /**
   * List all cached parsers
   */
  async list(): Promise<ParserCacheEntry[]> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => {
        logger.error("ParserCache", "Failed to list parsers:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        resolve(request.result as ParserCacheEntry[]);
      };
    });
  }

  /**
   * Clear all cached parsers
   */
  async clear(): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => {
        logger.error("ParserCache", "Failed to clear cache:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        logger.info("ParserCache", "Cleared parser cache");
        resolve();
      };
    });
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const parsers = await this.list();

    const stats: CacheStats = {
      totalSize: 0,
      parserCount: parsers.length,
      parsers: [],
    };

    for (const parser of parsers) {
      stats.totalSize += parser.size;
      stats.parsers.push({
        languageId: parser.languageId,
        size: parser.size,
        version: parser.version,
        downloadedAt: parser.downloadedAt,
      });
    }

    return stats;
  }

  /**
   * Check if a parser exists in cache
   */
  async has(languageId: string): Promise<boolean> {
    const entry = await this.get(languageId);
    return entry !== null;
  }

  /**
   * Get cache size in bytes
   */
  async getCacheSize(): Promise<number> {
    const stats = await this.getStats();
    return stats.totalSize;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
      logger.info("ParserCache", "Closed IndexedDB connection");
    }
  }
}

// Global cache instance
export const indexedDBParserCache = new IndexedDBParserCache();
