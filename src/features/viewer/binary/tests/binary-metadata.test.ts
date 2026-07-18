import { describe, expect, it } from "vitest";
import {
  formatHexPreview,
  getBinaryFileType,
  getBinaryMetadata,
  parseWasmSections,
} from "../lib/binary-metadata";

describe("binary metadata", () => {
  it("parses WebAssembly headers and sections", () => {
    const data = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x01, 0x00]);

    expect(parseWasmSections(data)).toEqual({
      version: 1,
      totalSize: 11,
      sections: [{ id: 1, name: "Type", size: 1 }],
    });
    expect(getBinaryMetadata(data, "/tmp/module.wasm").isWasm).toBe(true);
  });

  it("rejects non-WebAssembly data", () => {
    expect(parseWasmSections(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
  });

  it("formats binary types and a readable hex preview", () => {
    expect(getBinaryFileType("archive.zip")).toBe("ZIP Archive");
    expect(getBinaryFileType("unknown.data")).toBe("Binary File");
    expect(formatHexPreview(new Uint8Array([0x41, 0x00, 0x42]))).toContain("41 00 42");
    expect(formatHexPreview(new Uint8Array([0x41, 0x00, 0x42]))).toContain("|A.B");
  });
});
