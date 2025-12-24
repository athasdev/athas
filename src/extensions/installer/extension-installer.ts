/**
 * Extension Installer
 * Handles downloading and installing language extensions from CDN
 */

import {
  indexedDBParserCache,
  type ParserCacheEntry,
} from "@/features/editor/lib/wasm-parser/cache-indexeddb";
import { logger } from "@/features/editor/utils/logger";

export interface DownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface InstallOptions {
  onProgress?: (progress: DownloadProgress) => void;
  retryCount?: number;
  timeout?: number;
}

export class ExtensionInstaller {
  private abortControllers: Map<string, AbortController> = new Map();

  /**
   * Download a file with progress tracking
   */
  private async downloadWithProgress(
    url: string,
    options: InstallOptions = {},
  ): Promise<ArrayBuffer> {
    const { onProgress, retryCount = 3, timeout = 30000 } = options;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), timeout);

        const response = await fetch(url, {
          signal: abortController.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentLength = response.headers.get("content-length");
        const total = contentLength ? Number.parseInt(contentLength, 10) : 0;

        if (!response.body) {
          throw new Error("Response body is null");
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          chunks.push(value);
          loaded += value.length;

          if (onProgress && total > 0) {
            onProgress({
              loaded,
              total,
              percentage: (loaded / total) * 100,
            });
          }
        }

        // Combine chunks into single ArrayBuffer
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;

        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }

        return result.buffer;
      } catch (error) {
        if (attempt === retryCount) {
          throw error;
        }

        logger.warn(
          "ExtensionInstaller",
          `Download attempt ${attempt}/${retryCount} failed, retrying...`,
          error,
        );

        // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }

    throw new Error("Download failed after retries");
  }

  /**
   * Calculate SHA-256 checksum of data
   */
  private async calculateChecksum(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Verify checksum matches expected value
   */
  private async verifyChecksum(data: ArrayBuffer, expectedChecksum: string): Promise<boolean> {
    if (!expectedChecksum) return true; // Skip verification if no checksum provided

    const actualChecksum = await this.calculateChecksum(data);
    const match = actualChecksum === expectedChecksum;

    if (!match) {
      logger.error(
        "ExtensionInstaller",
        `Checksum mismatch! Expected: ${expectedChecksum}, Got: ${actualChecksum}`,
      );
    }

    return match;
  }

  /**
   * Install a language extension
   */
  async installLanguage(
    languageId: string,
    wasmUrl: string,
    highlightQueryUrl: string,
    options: {
      version?: string;
      checksum?: string;
      onProgress?: (progress: DownloadProgress) => void;
    } = {},
  ): Promise<void> {
    const { version = "1.0.0", checksum = "", onProgress } = options;

    logger.info("ExtensionInstaller", `Installing language extension: ${languageId}`);

    try {
      // Create abort controller for this installation
      const abortController = new AbortController();
      this.abortControllers.set(languageId, abortController);

      // Download WASM parser
      logger.debug("ExtensionInstaller", `Downloading WASM from: ${wasmUrl}`);

      const wasmData = await this.downloadWithProgress(wasmUrl, {
        onProgress: (progress) => {
          // Scale progress to 0-70% for WASM download
          onProgress?.({
            loaded: progress.loaded,
            total: progress.total,
            percentage: progress.percentage * 0.7,
          });
        },
      });

      // Verify checksum if provided
      if (checksum) {
        const isValid = await this.verifyChecksum(wasmData, checksum);
        if (!isValid) {
          throw new Error(`Checksum verification failed for ${languageId}`);
        }
      }

      // Download highlight query
      logger.debug("ExtensionInstaller", `Downloading highlight query from: ${highlightQueryUrl}`);

      let highlightQuery = "";
      try {
        const queryResponse = await fetch(highlightQueryUrl);
        if (queryResponse.ok) {
          highlightQuery = await queryResponse.text();
        } else {
          logger.warn(
            "ExtensionInstaller",
            `Failed to download highlight query (${queryResponse.status}), continuing without it`,
          );
        }
      } catch (error) {
        logger.warn(
          "ExtensionInstaller",
          "Failed to download highlight query, continuing without it:",
          error,
        );
      }

      // Report 80% progress after downloads
      onProgress?.({
        loaded: 80,
        total: 100,
        percentage: 80,
      });

      // Store in IndexedDB cache
      const cacheEntry: ParserCacheEntry = {
        languageId,
        wasmBlob: new Blob([wasmData]), // Legacy compatibility
        wasmData: wasmData, // Preferred: ArrayBuffer avoids WebKit blob issues
        highlightQuery,
        version,
        checksum: checksum || (await this.calculateChecksum(wasmData)),
        downloadedAt: Date.now(),
        lastUsedAt: Date.now(),
        size: wasmData.byteLength,
        sourceUrl: wasmUrl,
      };

      await indexedDBParserCache.set(cacheEntry);

      // Report 100% progress
      onProgress?.({
        loaded: 100,
        total: 100,
        percentage: 100,
      });

      logger.info(
        "ExtensionInstaller",
        `Successfully installed ${languageId} (${(wasmData.byteLength / 1024).toFixed(1)} KB)`,
      );
    } catch (error) {
      logger.error("ExtensionInstaller", `Failed to install ${languageId}:`, error);
      throw error;
    } finally {
      this.abortControllers.delete(languageId);
    }
  }

  /**
   * Uninstall a language extension
   */
  async uninstallLanguage(languageId: string): Promise<void> {
    logger.info("ExtensionInstaller", `Uninstalling language extension: ${languageId}`);

    try {
      await indexedDBParserCache.delete(languageId);
      logger.info("ExtensionInstaller", `Successfully uninstalled ${languageId}`);
    } catch (error) {
      logger.error("ExtensionInstaller", `Failed to uninstall ${languageId}:`, error);
      throw error;
    }
  }

  /**
   * Check if a language extension is installed
   */
  async isInstalled(languageId: string): Promise<boolean> {
    return await indexedDBParserCache.has(languageId);
  }

  /**
   * Get installed language version
   */
  async getInstalledVersion(languageId: string): Promise<string | null> {
    const entry = await indexedDBParserCache.get(languageId);
    return entry?.version || null;
  }

  /**
   * List all installed languages
   */
  async listInstalled(): Promise<
    Array<{ languageId: string; version: string; size: number; downloadedAt?: number }>
  > {
    const entries = await indexedDBParserCache.list();
    return entries.map((entry) => ({
      languageId: entry.languageId,
      version: entry.version,
      size: entry.size,
      downloadedAt: entry.downloadedAt,
    }));
  }

  /**
   * Cancel an ongoing installation
   */
  cancelInstallation(languageId: string): void {
    const controller = this.abortControllers.get(languageId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(languageId);
      logger.info("ExtensionInstaller", `Cancelled installation of ${languageId}`);
    }
  }
}

// Global installer instance
export const extensionInstaller = new ExtensionInstaller();
