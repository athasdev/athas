/**
 * Parser Cache
 * LRU cache for Tree-sitter parsers to manage memory usage
 */

import { logger } from "../../utils/logger";
import type { LoadedParser } from "./types";

interface CacheEntry {
  parser: LoadedParser;
  lastUsed: number;
}

export class ParserCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 10) {
    this.maxSize = maxSize;
  }

  /**
   * Get a parser from cache
   * Updates last used timestamp
   */
  get(languageId: string): LoadedParser | undefined {
    const entry = this.cache.get(languageId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.parser;
    }
    return undefined;
  }

  /**
   * Add a parser to cache
   * Evicts least recently used parser if cache is full
   */
  set(languageId: string, parser: LoadedParser): void {
    // If cache is full, evict LRU entry
    if (this.cache.size >= this.maxSize && !this.cache.has(languageId)) {
      this.evictLRU();
    }

    this.cache.set(languageId, {
      parser,
      lastUsed: Date.now(),
    });
  }

  /**
   * Check if a parser is in cache
   */
  has(languageId: string): boolean {
    return this.cache.has(languageId);
  }

  /**
   * Remove a parser from cache
   */
  delete(languageId: string): void {
    const entry = this.cache.get(languageId);
    if (entry) {
      entry.parser.parser.delete();
      this.cache.delete(languageId);
      logger.info("ParserCache", `Evicted parser for ${languageId}`);
    }
  }

  /**
   * Evict the least recently used parser
   */
  private evictLRU(): void {
    let lruLanguageId: string | null = null;
    let lruTime = Infinity;

    for (const [languageId, entry] of this.cache) {
      if (entry.lastUsed < lruTime) {
        lruTime = entry.lastUsed;
        lruLanguageId = languageId;
      }
    }

    if (lruLanguageId) {
      this.delete(lruLanguageId);
    }
  }

  /**
   * Clear all parsers from cache
   */
  clear(): void {
    for (const [languageId, entry] of this.cache) {
      entry.parser.parser.delete();
      logger.info("ParserCache", `Cleared parser for ${languageId}`);
    }
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    languages: string[];
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      languages: Array.from(this.cache.keys()),
    };
  }
}

export const parserCache = new ParserCache(10);
