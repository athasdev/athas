interface ExtensionLoadCandidate {
  manifest: {
    id: string;
    displayName: string;
  };
}

interface ExtensionLoadBatchOptions {
  concurrency?: number;
}

export class ExtensionLoadError extends Error {
  readonly _tag = "ExtensionLoadError";
  readonly extensionId: string;
  readonly displayName: string;
  readonly reason: unknown;

  constructor(fields: { extensionId: string; displayName: string; reason: unknown }) {
    super(`Failed to load ${fields.displayName}`);
    this.name = "ExtensionLoadError";
    this.extensionId = fields.extensionId;
    this.displayName = fields.displayName;
    this.reason = fields.reason;
  }
}

export type ExtensionLoadResult<T extends ExtensionLoadCandidate> =
  | {
      status: "loaded";
      extension: T;
    }
  | {
      status: "failed";
      extension: T;
      error: ExtensionLoadError;
    };

const DEFAULT_EXTENSION_LOAD_CONCURRENCY = 4;

export function runExtensionLoadBatch<T extends ExtensionLoadCandidate>(
  extensions: Iterable<T>,
  load: (extension: T) => Promise<void>,
  options: ExtensionLoadBatchOptions = {},
): Promise<Array<ExtensionLoadResult<T>>> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_EXTENSION_LOAD_CONCURRENCY);

  const items = Array.from(extensions);
  const results: Array<ExtensionLoadResult<T>> = Array.from({ length: items.length });
  let next = 0;
  // A small worker pool: results keep registry order however the loads finish.
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const extension = items[index]!;
      try {
        await load(extension);
        results[index] = { status: "loaded", extension };
      } catch (reason) {
        results[index] = {
          status: "failed",
          extension,
          error: new ExtensionLoadError({
            extensionId: extension.manifest.id,
            displayName: extension.manifest.displayName,
            reason,
          }),
        };
      }
    }
  };
  return Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  ).then(() => results);
}
