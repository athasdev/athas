/**
 * Extension Installer
 * Handles downloading and installing language extensions from CDN
 */

import {
  indexedDBParserCache,
  type ParserCacheEntry,
} from "@/features/editor/lib/wasm-parser/cache-indexeddb";
import { logger } from "@/features/editor/utils/logger";
import { Cause, Data, Effect, Exit, Option, Schedule } from "effect";

export interface ExtensionDownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface ExtensionInstallOptions {
  extensionId?: string;
  version?: string;
  checksum?: string;
  onProgress?: (progress: ExtensionDownloadProgress) => void;
  retryCount?: number;
  timeout?: number;
  retryBaseDelay?: number;
}

type DownloadOptions = Pick<
  ExtensionInstallOptions,
  "onProgress" | "retryCount" | "timeout" | "retryBaseDelay"
>;

export class ExtensionDownloadError extends Data.TaggedError("ExtensionDownloadError")<{
  message: string;
  url: string;
  reason: unknown;
}> {}

export class ExtensionDownloadTimeoutError extends Data.TaggedError(
  "ExtensionDownloadTimeoutError",
)<{
  message: string;
  url: string;
  timeout: number;
}> {}

export class ExtensionChecksumError extends Data.TaggedError("ExtensionChecksumError")<{
  message: string;
  languageId: string;
  expectedChecksum?: string;
  actualChecksum?: string;
  reason?: unknown;
}> {}

export class ExtensionStorageError extends Data.TaggedError("ExtensionStorageError")<{
  message: string;
  languageId: string;
  reason: unknown;
}> {}

export class ExtensionInstallCancelledError extends Data.TaggedError(
  "ExtensionInstallCancelledError",
)<{
  message: string;
  languageId: string;
}> {}

export type ExtensionInstallationError =
  | ExtensionDownloadError
  | ExtensionDownloadTimeoutError
  | ExtensionChecksumError
  | ExtensionStorageError
  | ExtensionInstallCancelledError;

type ExtensionInstallationProgramError = Exclude<
  ExtensionInstallationError,
  ExtensionInstallCancelledError
>;

export class ExtensionInstaller {
  private abortControllers: Map<string, AbortController> = new Map();

  private downloadWithProgress(
    url: string,
    options: DownloadOptions = {},
  ): Effect.Effect<ArrayBuffer, ExtensionDownloadError | ExtensionDownloadTimeoutError> {
    const { onProgress, retryCount = 3, timeout = 30_000, retryBaseDelay = 1_000 } = options;
    const attempts = Math.max(1, retryCount);
    let attempt = 0;

    const downloadAttempt = Effect.suspend(() => {
      attempt += 1;

      return Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(url, { signal });

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

          try {
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
          } finally {
            reader.releaseLock();
          }

          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const result = new Uint8Array(totalLength);
          let offset = 0;

          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }

          return result.buffer;
        },
        catch: (reason) =>
          new ExtensionDownloadError({
            message: `Failed to download ${url}`,
            url,
            reason,
          }),
      }).pipe(
        Effect.timeoutFail({
          duration: timeout,
          onTimeout: () =>
            new ExtensionDownloadTimeoutError({
              message: `Download timed out after ${timeout}ms: ${url}`,
              url,
              timeout,
            }),
        }),
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (attempt < attempts) {
              logger.warn(
                "ExtensionInstaller",
                `Download attempt ${attempt}/${attempts} failed, retrying...`,
                error,
              );
            }
          }),
        ),
      );
    });

    const retryPolicy = Schedule.exponential(Math.max(0, retryBaseDelay)).pipe(
      Schedule.intersect(Schedule.recurs(attempts - 1)),
    );

    return downloadAttempt.pipe(Effect.retry(retryPolicy));
  }

  private downloadOptionalText(url: string, timeout: number): Effect.Effect<string, never> {
    return Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.text();
      },
      catch: (reason) =>
        new ExtensionDownloadError({
          message: `Failed to download ${url}`,
          url,
          reason,
        }),
    }).pipe(
      Effect.timeoutFail({
        duration: timeout,
        onTimeout: () =>
          new ExtensionDownloadTimeoutError({
            message: `Download timed out after ${timeout}ms: ${url}`,
            url,
            timeout,
          }),
      }),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.warn(
            "ExtensionInstaller",
            "Failed to download highlight query, continuing without it:",
            error,
          );
          return "";
        }),
      ),
    );
  }

  private calculateChecksum(
    languageId: string,
    data: ArrayBuffer,
    expectedChecksum?: string,
  ): Effect.Effect<string, ExtensionChecksumError> {
    return Effect.tryPromise({
      try: async () => {
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
      },
      catch: (reason) =>
        new ExtensionChecksumError({
          message: `Could not calculate checksum for ${languageId}`,
          languageId,
          expectedChecksum,
          reason,
        }),
    });
  }

  private createInstallation(
    languageId: string,
    wasmUrl: string,
    highlightQueryUrl: string,
    options: ExtensionInstallOptions,
  ): Effect.Effect<void, ExtensionInstallationProgramError> {
    const {
      extensionId,
      version = "1.0.0",
      checksum = "",
      onProgress,
      retryCount,
      timeout = 30_000,
      retryBaseDelay,
    } = options;

    return Effect.gen(this, function* () {
      logger.debug("ExtensionInstaller", `Downloading WASM from: ${wasmUrl}`);

      const wasmData = yield* this.downloadWithProgress(wasmUrl, {
        retryCount,
        timeout,
        retryBaseDelay,
        onProgress: (progress) => {
          onProgress?.({
            loaded: progress.loaded,
            total: progress.total,
            percentage: progress.percentage * 0.7,
          });
        },
      });

      const actualChecksum = yield* this.calculateChecksum(languageId, wasmData, checksum);
      if (checksum && actualChecksum !== checksum) {
        return yield* new ExtensionChecksumError({
          message: `Checksum verification failed for ${languageId}`,
          languageId,
          expectedChecksum: checksum,
          actualChecksum,
        });
      }

      logger.debug("ExtensionInstaller", `Downloading highlight query from: ${highlightQueryUrl}`);
      const highlightQuery = yield* this.downloadOptionalText(highlightQueryUrl, timeout);

      onProgress?.({
        loaded: 80,
        total: 100,
        percentage: 80,
      });

      const cacheEntry: ParserCacheEntry = {
        languageId,
        extensionId,
        wasmBlob: new Blob([wasmData]),
        wasmData,
        highlightQuery,
        version,
        checksum: checksum || actualChecksum,
        downloadedAt: Date.now(),
        lastUsedAt: Date.now(),
        size: wasmData.byteLength,
        sourceUrl: wasmUrl,
      };

      yield* Effect.tryPromise({
        try: () => indexedDBParserCache.set(cacheEntry),
        catch: (reason) =>
          new ExtensionStorageError({
            message: `Failed to store language extension ${languageId}`,
            languageId,
            reason,
          }),
      });

      onProgress?.({
        loaded: 100,
        total: 100,
        percentage: 100,
      });

      logger.info(
        "ExtensionInstaller",
        `Successfully installed ${languageId} (${(wasmData.byteLength / 1024).toFixed(1)} KB)`,
      );
    });
  }

  async installLanguage(
    languageId: string,
    wasmUrl: string,
    highlightQueryUrl: string,
    options: ExtensionInstallOptions = {},
  ): Promise<void> {
    logger.info("ExtensionInstaller", `Installing language extension: ${languageId}`);
    this.cancelInstallation(languageId);
    const abortController = new AbortController();
    this.abortControllers.set(languageId, abortController);

    try {
      const exit = await Effect.runPromiseExit(
        this.createInstallation(languageId, wasmUrl, highlightQueryUrl, options),
        {
          signal: abortController.signal,
        },
      );

      if (Exit.isSuccess(exit)) {
        return;
      }

      if (abortController.signal.aborted || Cause.isInterruptedOnly(exit.cause)) {
        throw new ExtensionInstallCancelledError({
          message: `Installation cancelled for ${languageId}`,
          languageId,
        });
      }

      const failure = Cause.failureOption(exit.cause);
      if (Option.isSome(failure)) {
        throw failure.value;
      }

      throw Cause.squash(exit.cause);
    } catch (error) {
      logger.error("ExtensionInstaller", `Failed to install ${languageId}:`, error);
      throw error;
    } finally {
      if (this.abortControllers.get(languageId) === abortController) {
        this.abortControllers.delete(languageId);
      }
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
    Array<{
      languageId: string;
      extensionId?: string;
      version: string;
      size: number;
      downloadedAt?: number;
    }>
  > {
    const entries = await indexedDBParserCache.list();
    return entries.map((entry) => ({
      languageId: entry.languageId,
      extensionId: entry.extensionId,
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
      logger.info("ExtensionInstaller", `Cancelled installation of ${languageId}`);
    }
  }
}

// Global installer instance
export const extensionInstaller = new ExtensionInstaller();
