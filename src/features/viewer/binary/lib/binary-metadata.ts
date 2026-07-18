import { formatFileSize } from "@/utils/format-file-size";

interface WasmSection {
  id: number;
  name: string;
  size: number;
}

interface WasmMetadata {
  version: number;
  sections: WasmSection[];
  totalSize: number;
}

interface BinaryMetadata {
  fileSize: number;
  fileType: string;
  isWasm: boolean;
  wasmMetadata?: WasmMetadata;
  hexPreview: string;
}

const WASM_SECTION_NAMES: Record<number, string> = {
  0: "Custom",
  1: "Type",
  2: "Import",
  3: "Function",
  4: "Table",
  5: "Memory",
  6: "Global",
  7: "Export",
  8: "Start",
  9: "Element",
  10: "Code",
  11: "Data",
  12: "Data Count",
};

function parseWasmSections(data: Uint8Array): WasmMetadata | null {
  if (
    data.length < 8 ||
    data[0] !== 0x00 ||
    data[1] !== 0x61 ||
    data[2] !== 0x73 ||
    data[3] !== 0x6d
  ) {
    return null;
  }

  const version = data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24);
  const sections: WasmSection[] = [];
  let offset = 8;

  while (offset < data.length) {
    const sectionId = data[offset++];
    let size = 0;
    let shift = 0;
    let byte = 0;

    do {
      if (offset >= data.length) break;
      byte = data[offset++];
      size |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);

    sections.push({
      id: sectionId,
      name: WASM_SECTION_NAMES[sectionId] || `Unknown (${sectionId})`,
      size,
    });
    offset += size;
  }

  return { version, sections, totalSize: data.length };
}

function formatHexPreview(data: Uint8Array, maxBytes = 256): string {
  const lines: string[] = [];
  const limit = Math.min(data.length, maxBytes);

  for (let index = 0; index < limit; index += 16) {
    const hex: string[] = [];
    const ascii: string[] = [];

    for (let byteIndex = 0; byteIndex < 16; byteIndex++) {
      if (index + byteIndex < limit) {
        const byte = data[index + byteIndex];
        hex.push(byte.toString(16).padStart(2, "0"));
        ascii.push(byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".");
      } else {
        hex.push("  ");
        ascii.push(" ");
      }
    }

    const address = index.toString(16).padStart(8, "0");
    lines.push(
      `${address}  ${hex.slice(0, 8).join(" ")}  ${hex.slice(8).join(" ")}  |${ascii.join("")}|`,
    );
  }

  if (data.length > maxBytes) {
    lines.push(`... ${formatFileSize(data.length - maxBytes)} more`);
  }

  return lines.join("\n");
}

function getBinaryFileType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  const types: Record<string, string> = {
    wasm: "WebAssembly Binary",
    exe: "Windows Executable",
    dll: "Dynamic Link Library",
    so: "Shared Object",
    dylib: "Dynamic Library",
    bin: "Binary Data",
    o: "Object File",
    obj: "Object File",
    a: "Static Library",
    lib: "Static Library",
    class: "Java Class File",
    pyc: "Python Bytecode",
    pyo: "Python Optimized Bytecode",
    woff: "Web Open Font Format",
    woff2: "Web Open Font Format 2",
    ttf: "TrueType Font",
    otf: "OpenType Font",
    eot: "Embedded OpenType Font",
    zip: "ZIP Archive",
    tar: "Tape Archive",
    gz: "Gzip Compressed",
    bz2: "Bzip2 Compressed",
    xz: "XZ Compressed",
    "7z": "7-Zip Archive",
    rar: "RAR Archive",
    jar: "Java Archive",
    war: "Web Application Archive",
    ear: "Enterprise Archive",
    iso: "Disk Image",
    dmg: "macOS Disk Image",
    msi: "Windows Installer",
  };

  return types[extension] || "Binary File";
}

function getBinaryMetadata(data: Uint8Array, path: string): BinaryMetadata {
  const isWasm = path.toLowerCase().endsWith(".wasm");
  const wasmMetadata = isWasm ? parseWasmSections(data) : null;

  return {
    fileSize: data.length,
    fileType: getBinaryFileType(path),
    isWasm,
    wasmMetadata: wasmMetadata ?? undefined,
    hexPreview: formatHexPreview(data),
  };
}

export { formatHexPreview, getBinaryFileType, getBinaryMetadata, parseWasmSections };
export type { BinaryMetadata, WasmMetadata, WasmSection };
