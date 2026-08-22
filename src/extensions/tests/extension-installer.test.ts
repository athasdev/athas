import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ExtensionChecksumError,
  ExtensionDownloadError,
  ExtensionDownloadTimeoutError,
  ExtensionInstallCancelledError,
  ExtensionInstaller,
  ExtensionStorageError,
} from "../installer/extension-installer";

const mocks = vi.hoisted(() => ({
  cacheDelete: vi.fn<(languageId: string) => Promise<void>>(),
  cacheGet: vi.fn<(languageId: string) => Promise<unknown>>(),
  cacheHas: vi.fn<(languageId: string) => Promise<boolean>>(),
  cacheList: vi.fn<() => Promise<unknown[]>>(),
  cacheSet: vi.fn<(entry: unknown) => Promise<void>>(),
  loggerDebug: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("@/features/editor/lib/wasm-parser/cache-indexeddb", () => ({
  indexedDBParserCache: {
    delete: mocks.cacheDelete,
    get: mocks.cacheGet,
    has: mocks.cacheHas,
    list: mocks.cacheList,
    set: mocks.cacheSet,
  },
}));

vi.mock("@/features/editor/utils/logger", () => ({
  logger: {
    debug: mocks.loggerDebug,
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

const wasmBytes = new Uint8Array([0, 97, 115, 109]);

function wasmResponse(): Response {
  return new Response(wasmBytes, {
    headers: { "content-length": String(wasmBytes.byteLength) },
  });
}

function highlightResponse(): Response {
  return new Response("(identifier) @variable");
}

describe("extension installer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cacheSet.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads, verifies, and stores a language extension", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(wasmResponse())
      .mockResolvedValueOnce(highlightResponse());
    vi.stubGlobal("fetch", fetchMock);
    const onProgress = vi.fn();

    await new ExtensionInstaller().installLanguage(
      "typescript",
      "https://cdn.example.com/parser.wasm",
      "https://cdn.example.com/highlights.scm",
      {
        extensionId: "athas.typescript",
        version: "1.2.3",
        onProgress,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(mocks.cacheSet).toHaveBeenCalledWith(
      expect.objectContaining({
        languageId: "typescript",
        extensionId: "athas.typescript",
        version: "1.2.3",
        highlightQuery: "(identifier) @variable",
        size: wasmBytes.byteLength,
        sourceUrl: "https://cdn.example.com/parser.wasm",
      }),
    );
    expect(onProgress.mock.calls.map(([progress]) => progress.percentage)).toEqual(
      expect.arrayContaining([70, 80, 100]),
    );
  });

  it("retries failed downloads with bounded backoff", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503, statusText: "Unavailable" }))
      .mockResolvedValueOnce(wasmResponse())
      .mockResolvedValueOnce(highlightResponse());
    vi.stubGlobal("fetch", fetchMock);

    await new ExtensionInstaller().installLanguage(
      "rust",
      "https://cdn.example.com/parser.wasm",
      "https://cdn.example.com/highlights.scm",
      { retryCount: 2, retryBaseDelay: 1 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "ExtensionInstaller",
      "Download attempt 1/2 failed, retrying...",
      expect.anything(),
    );
  });

  it("returns a typed download failure after exhausting retries", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503, statusText: "Unavailable" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new ExtensionInstaller().installLanguage(
        "swift",
        "https://cdn.example.com/parser.wasm",
        "https://cdn.example.com/highlights.scm",
        { retryCount: 2, retryBaseDelay: 1 },
      ),
    ).rejects.toBeInstanceOf(ExtensionDownloadError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });

  it("keeps highlight-query failures non-fatal", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(wasmResponse())
      .mockResolvedValueOnce(new Response(null, { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new ExtensionInstaller().installLanguage(
        "elixir",
        "https://cdn.example.com/parser.wasm",
        "https://cdn.example.com/highlights.scm",
        { retryCount: 1 },
      ),
    ).resolves.toBeUndefined();

    expect(mocks.cacheSet).toHaveBeenCalledWith(expect.objectContaining({ highlightQuery: "" }));
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "ExtensionInstaller",
      "Failed to download highlight query, continuing without it:",
      expect.anything(),
    );
  });

  it("fails with a typed timeout and aborts the active fetch", async () => {
    let activeSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      activeSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        activeSignal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const installation = new ExtensionInstaller().installLanguage(
      "go",
      "https://cdn.example.com/parser.wasm",
      "https://cdn.example.com/highlights.scm",
      { retryCount: 1, timeout: 10 },
    );

    await expect(installation).rejects.toBeInstanceOf(ExtensionDownloadTimeoutError);
    expect(activeSignal?.aborted).toBe(true);
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });

  it("cancels the Effect runtime and allows a later install for the same language", async () => {
    let activeSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce((_input, init) => {
      activeSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        activeSignal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const installer = new ExtensionInstaller();

    const cancelledInstallation = installer.installLanguage(
      "python",
      "https://cdn.example.com/parser.wasm",
      "https://cdn.example.com/highlights.scm",
      { retryCount: 1 },
    );
    await vi.waitFor(() => expect(activeSignal).toBeInstanceOf(AbortSignal));

    installer.cancelInstallation("python");

    await expect(cancelledInstallation).rejects.toBeInstanceOf(ExtensionInstallCancelledError);
    expect(activeSignal?.aborted).toBe(true);

    fetchMock.mockResolvedValueOnce(wasmResponse()).mockResolvedValueOnce(highlightResponse());
    await expect(
      installer.installLanguage(
        "python",
        "https://cdn.example.com/parser.wasm",
        "https://cdn.example.com/highlights.scm",
      ),
    ).resolves.toBeUndefined();
  });

  it("reports checksum mismatches as typed failures before persistence", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(wasmResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new ExtensionInstaller().installLanguage(
        "zig",
        "https://cdn.example.com/parser.wasm",
        "https://cdn.example.com/highlights.scm",
        { checksum: "not-the-real-checksum", retryCount: 1 },
      ),
    ).rejects.toMatchObject({
      _tag: "ExtensionChecksumError",
      languageId: "zig",
      expectedChecksum: "not-the-real-checksum",
    } satisfies Partial<ExtensionChecksumError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });

  it("reports persistence failures with their typed cause", async () => {
    const storageFailure = new Error("IndexedDB unavailable");
    mocks.cacheSet.mockRejectedValue(storageFailure);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(wasmResponse())
        .mockResolvedValueOnce(highlightResponse()),
    );

    await expect(
      new ExtensionInstaller().installLanguage(
        "ruby",
        "https://cdn.example.com/parser.wasm",
        "https://cdn.example.com/highlights.scm",
        { retryCount: 1 },
      ),
    ).rejects.toEqual(
      new ExtensionStorageError({
        message: "Failed to store language extension ruby",
        languageId: "ruby",
        reason: storageFailure,
      }),
    );
  });
});
