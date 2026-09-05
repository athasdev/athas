import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ParserCacheEntry } from "../lib/wasm-parser/cache-indexeddb";
import { computeWasmChecksum } from "../lib/wasm-parser/checksum";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  loadLanguage: vi.fn(),
  getManifest: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../lib/wasm-parser/cache-indexeddb", () => ({ indexedDBParserCache: mocks }));
vi.mock("@/extensions/languages/language-packager", () => ({
  getLanguageExtensionById: mocks.getManifest,
}));
vi.mock("../lib/wasm-parser/extension-assets", () => ({
  fetchHighlightQuery: async () => ({ query: null }),
}));
vi.mock("../utils/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("web-tree-sitter", () => ({
  Language: { load: mocks.loadLanguage },
  Parser: class {
    static async init() {}
    setLanguage() {}
    delete() {}
  },
  Query: class {},
}));

const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const sourceUrl = "https://extensions.example/test/parser.wasm";

function cached(overrides: Partial<ParserCacheEntry> = {}): ParserCacheEntry {
  return {
    languageId: "test",
    wasmData: wasm.slice().buffer,
    wasmBlob: new Blob([wasm]),
    highlightQuery: "",
    version: "1.0.0",
    checksum: "",
    downloadedAt: 1,
    lastUsedAt: 1,
    size: wasm.byteLength,
    sourceUrl,
    ...overrides,
  };
}

async function load(wasmPath = sourceUrl) {
  const { wasmParserLoader } = await import("../lib/wasm-parser/loader");
  return wasmParserLoader.loadParser({ languageId: "test", wasmPath });
}

describe("parser cache loading", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.get.mockResolvedValue(null);
    mocks.set.mockResolvedValue(undefined);
    mocks.delete.mockResolvedValue(undefined);
    mocks.getManifest.mockReturnValue({ version: "3.2.1" });
    mocks.loadLanguage.mockResolvedValue({});
    mocks.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => wasm.slice().buffer });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("stores downloaded bytes with their manifest version and checksum", async () => {
    await load();
    const entry = mocks.set.mock.calls[0][0] as ParserCacheEntry;
    expect(entry.version).toBe("3.2.1");
    expect(entry.checksum).toBe(await computeWasmChecksum(wasm));
    expect(entry.sourceUrl).toBe(sourceUrl);
    expect(new Uint8Array(entry.wasmData!)).toEqual(wasm);
    expect(new Uint8Array(await entry.wasmBlob.arrayBuffer())).toEqual(wasm);
    expect(entry.size).toBe(wasm.byteLength);
  });

  it("also writes checksums for bundled parsers without inventing a version", async () => {
    mocks.getManifest.mockReturnValue(undefined);
    await load("/tree-sitter/parsers/test/parser.wasm");
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ version: "unknown", checksum: await computeWasmChecksum(wasm) }),
    );
  });

  it("loads verified cache entries without fetching the parser again", async () => {
    mocks.get.mockResolvedValue(cached({ checksum: await computeWasmChecksum(wasm) }));
    await load();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.loadLanguage).toHaveBeenCalledWith(wasm);
  });

  it("evicts a checksum mismatch and loads newly downloaded bytes", async () => {
    const corrupted = wasm.slice();
    corrupted[7] = 255;
    mocks.get.mockResolvedValue(
      cached({ wasmData: corrupted.buffer, checksum: await computeWasmChecksum(wasm) }),
    );
    await load();
    expect(mocks.delete).toHaveBeenCalledExactlyOnceWith("test");
    expect(mocks.fetch).toHaveBeenCalledWith(sourceUrl);
    expect(mocks.loadLanguage).toHaveBeenCalledExactlyOnceWith(wasm);
    expect(mocks.set).toHaveBeenCalledOnce();
  });

  it("never loads corrupt bytes when replacing them fails offline", async () => {
    mocks.get.mockResolvedValue(cached({ checksum: "invalid" }));
    mocks.fetch.mockRejectedValue(new Error("offline"));
    await expect(load()).rejects.toThrow("offline");
    expect(mocks.delete).toHaveBeenCalledWith("test");
    expect(mocks.loadLanguage).not.toHaveBeenCalled();
  });

  it("keeps legacy blob-only cache entries usable offline", async () => {
    mocks.get.mockResolvedValue(cached({ wasmData: undefined }));
    await load();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.loadLanguage).toHaveBeenCalledWith(wasm);
  });

  it("does not stop a valid download from loading when the cache cannot be written", async () => {
    mocks.set.mockRejectedValue(new Error("quota exceeded"));
    await expect(load()).resolves.toHaveProperty("languageId", "test");
    expect(mocks.loadLanguage).toHaveBeenCalledWith(wasm);
  });
});
