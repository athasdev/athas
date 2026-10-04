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

  it("decodes multi-byte section sizes and skips over section bodies", () => {
    const code = Array.from({ length: 200 }, () => 0);
    const data = new Uint8Array([
      0x00,
      0x61,
      0x73,
      0x6d,
      0x01,
      0x00,
      0x00,
      0x00,
      0x0a,
      0xc8,
      0x01,
      ...code,
      0x2a,
      0x00,
    ]);

    expect(parseWasmSections(data)?.sections).toEqual([
      { id: 10, name: "Code", size: 200 },
      { id: 42, name: "Unknown (42)", size: 0 },
    ]);
  });

  it("only parses WebAssembly sections for .wasm files", () => {
    const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

    expect(getBinaryMetadata(wasm, "/tmp/module.bin")).toMatchObject({
      isWasm: false,
      wasmMetadata: undefined,
      fileType: "Binary Data",
      fileSize: 8,
    });
    expect(getBinaryMetadata(new Uint8Array([1, 2, 3]), "/tmp/BROKEN.WASM")).toMatchObject({
      isWasm: true,
      wasmMetadata: undefined,
    });
  });

  it("lays out the hex preview in addressed rows of 16 bytes and truncates long files", () => {
    const data = new Uint8Array(Array.from({ length: 40 }, (_, index) => index + 0x30));
    const lines = formatHexPreview(data, 32).split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith("00000000  30 31 32 33 34 35 36 37  38 39 3a 3b")).toBe(true);
    expect(lines[1].startsWith("00000010  ")).toBe(true);
    expect(lines[2]).toBe("... 8.0 B more");
  });

  it("pads the last partial row so the ASCII column stays aligned", () => {
    const [line] = formatHexPreview(new Uint8Array([0x41, 0x42])).split("\n");

    expect(line.endsWith("|AB              |")).toBe(true);
  });
});
