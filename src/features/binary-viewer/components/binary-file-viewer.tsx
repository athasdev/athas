import { readFile } from "@tauri-apps/plugin-fs";
import { FileIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { formatFileSize } from "@/features/image-editor/utils/image-file-utils";
import { cn } from "@/utils/cn";
import { getRelativePath } from "@/utils/path-helpers";

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
  // WASM magic number: \0asm
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
    if (offset >= data.length) break;
    const sectionId = data[offset++];

    // Read LEB128 encoded section size
    let size = 0;
    let shift = 0;
    let byte: number;
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

  for (let i = 0; i < limit; i += 16) {
    const hex: string[] = [];
    const ascii: string[] = [];

    for (let j = 0; j < 16; j++) {
      if (i + j < limit) {
        hex.push(data[i + j].toString(16).padStart(2, "0"));
        const ch = data[i + j];
        ascii.push(ch >= 0x20 && ch <= 0x7e ? String.fromCharCode(ch) : ".");
      } else {
        hex.push("  ");
        ascii.push(" ");
      }
    }

    const addr = i.toString(16).padStart(8, "0");
    lines.push(
      `${addr}  ${hex.slice(0, 8).join(" ")}  ${hex.slice(8).join(" ")}  |${ascii.join("")}|`,
    );
  }

  if (data.length > maxBytes) {
    lines.push(`... ${formatFileSize(data.length - maxBytes)} more`);
  }

  return lines.join("\n");
}

function getFileType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const typeMap: Record<string, string> = {
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
  return typeMap[ext] || "Binary File";
}

interface BinaryFileViewerProps {
  filePath: string;
  fileName: string;
  rootFolderPath?: string;
}

export function BinaryFileViewer({ filePath, fileName, rootFolderPath }: BinaryFileViewerProps) {
  const [metadata, setMetadata] = useState<BinaryMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ext = fileName.split(".").pop()?.toUpperCase() || "";
  const relativePath = getRelativePath(filePath, rootFolderPath);

  useEffect(() => {
    const loadMetadata = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await readFile(filePath);
        const isWasm = filePath.toLowerCase().endsWith(".wasm");
        const wasmMetadata = isWasm ? parseWasmSections(data) : null;

        setMetadata({
          fileSize: data.length,
          fileType: getFileType(filePath),
          isWasm,
          wasmMetadata: wasmMetadata ?? undefined,
          hexPreview: formatHexPreview(data),
        });
      } catch (err) {
        setError(`Failed to read file: ${err}`);
      } finally {
        setLoading(false);
      }
    };

    loadMetadata();
  }, [filePath]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-primary-bg">
        <div className="rounded-lg border border-border/60 bg-secondary-bg px-3 py-2 text-text-lighter text-xs">
          Loading binary file...
        </div>
      </div>
    );
  }

  if (error || !metadata) {
    return (
      <div className="flex h-full items-center justify-center bg-primary-bg">
        <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-error text-xs">
          {error || "Failed to load file"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg">
      {/* Header */}
      <div className="flex items-center gap-2 border-border border-b bg-secondary-bg px-4 py-2.5">
        <FileIcon size={14} className="shrink-0 text-text" />
        <span className="ui-font truncate text-text text-xs">
          {fileName} {ext && <>&#8226; {ext}</>}
        </span>
        <span className="ui-font ml-auto text-text-lighter text-xs">{metadata.fileType}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* File Info Card */}
          <div className="rounded-lg border border-border/60 bg-secondary-bg">
            <div className="border-border/40 border-b px-4 py-2.5">
              <span className="ui-font font-medium text-text text-xs">File Information</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 p-4">
              <InfoRow label="Type" value={metadata.fileType} />
              <InfoRow label="Size" value={formatFileSize(metadata.fileSize)} />
              <InfoRow label="Extension" value={`.${ext.toLowerCase()}`} />
              <InfoRow label="Path" value={relativePath} />
            </div>
          </div>

          {/* WASM Metadata */}
          {metadata.wasmMetadata && (
            <div className="rounded-lg border border-border/60 bg-secondary-bg">
              <div className="border-border/40 border-b px-4 py-2.5">
                <span className="ui-font font-medium text-text text-xs">WebAssembly Module</span>
              </div>
              <div className="p-4">
                <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2">
                  <InfoRow label="WASM Version" value={`${metadata.wasmMetadata.version}`} />
                  <InfoRow label="Sections" value={`${metadata.wasmMetadata.sections.length}`} />
                </div>

                {metadata.wasmMetadata.sections.length > 0 && (
                  <div className="mt-3 rounded border border-border/40 overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-border/40 border-b bg-primary-bg/50">
                          <th className="ui-font px-3 py-1.5 text-left text-text-lighter text-xs font-normal">
                            Section
                          </th>
                          <th className="ui-font px-3 py-1.5 text-right text-text-lighter text-xs font-normal">
                            Size
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {metadata.wasmMetadata.sections.map((section, i) => (
                          <tr
                            key={`${section.id}-${i}`}
                            className={cn(
                              "border-border/20 border-b last:border-b-0",
                              i % 2 === 0 ? "bg-transparent" : "bg-primary-bg/30",
                            )}
                          >
                            <td className="ui-font px-3 py-1.5 text-text text-xs">
                              {section.name}
                            </td>
                            <td className="ui-font px-3 py-1.5 text-right text-text-lighter text-xs tabular-nums">
                              {formatFileSize(section.size)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hex Preview */}
          <div className="rounded-lg border border-border/60 bg-secondary-bg">
            <div className="border-border/40 border-b px-4 py-2.5">
              <span className="ui-font font-medium text-text text-xs">Hex Preview</span>
            </div>
            <div className="overflow-auto p-4">
              <pre className="font-mono text-[11px] leading-[18px] text-text-lighter">
                {metadata.hexPreview}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 border-border border-t bg-secondary-bg px-4 py-1.5">
        <span className="ui-font text-text-lighter text-xs">{metadata.fileType}</span>
        <span className="text-border">&#8226;</span>
        <span className="ui-font text-text-lighter text-xs">
          {formatFileSize(metadata.fileSize)}
        </span>
        <span className="text-border">&#8226;</span>
        <span className="ui-font text-text-lighter text-xs">{relativePath}</span>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="ui-font shrink-0 text-text-lighter text-xs">{label}</span>
      <span className="ui-font min-w-0 truncate text-text text-xs">{value}</span>
    </div>
  );
}
