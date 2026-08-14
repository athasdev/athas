import { Data, Effect } from "effect";

interface ExtensionLoadCandidate {
  manifest: {
    id: string;
    displayName: string;
  };
}

interface ExtensionLoadBatchOptions {
  concurrency?: number;
}

export class ExtensionLoadError extends Data.TaggedError("ExtensionLoadError")<{
  extensionId: string;
  displayName: string;
  reason: unknown;
}> {}

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

  const program = Effect.forEach(
    extensions,
    (extension) =>
      Effect.tryPromise({
        try: () => load(extension),
        catch: (reason) =>
          new ExtensionLoadError({
            extensionId: extension.manifest.id,
            displayName: extension.manifest.displayName,
            reason,
          }),
      }).pipe(
        Effect.match({
          onFailure: (error): ExtensionLoadResult<T> => ({
            status: "failed",
            extension,
            error,
          }),
          onSuccess: (): ExtensionLoadResult<T> => ({
            status: "loaded",
            extension,
          }),
        }),
      ),
    { concurrency },
  );

  return Effect.runPromise(program);
}
