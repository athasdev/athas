import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { FileIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { Token } from "@/features/editor/extensions/types";
import type { LineToken } from "@/features/editor/types/editor";
import { isBinaryFile, isImageFile } from "@/features/file-system/controllers/file-utils";
import { formatFileSize } from "@/features/image-editor/utils/image-file-utils";
import { useFilePreview } from "../hooks/use-file-preview";

interface FilePreviewProps {
  filePath: string | null;
}

interface LineData {
  lineNumber: number;
  content: string;
  tokens: LineToken[];
}

const IMAGE_MIME_TYPE_BY_EXT: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
  jfif: "image/jpeg",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pjp: "image/jpeg",
  pjpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

function getImageMimeType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return IMAGE_MIME_TYPE_BY_EXT[extension] || "image/png";
}

function useImagePreview(filePath: string | null, enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let objectUrl: string | null = null;

    if (!enabled || !filePath) {
      setSrc(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const load = async () => {
      try {
        const content = await readFile(filePath);
        if (isCancelled) return;

        const blob = new Blob([content], { type: getImageMimeType(filePath) });
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (readError) {
        if (isCancelled) return;
        try {
          setSrc(convertFileSrc(filePath));
        } catch {
          setError(`Failed to load image: ${readError}`);
          setSrc(null);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [enabled, filePath]);

  return { src, isLoading, error };
}

const BINARY_TYPE_MAP: Record<string, string> = {
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
  woff: "Web Open Font Format",
  woff2: "Web Open Font Format 2",
  ttf: "TrueType Font",
  otf: "OpenType Font",
  zip: "ZIP Archive",
  tar: "Tape Archive",
  gz: "Gzip Compressed",
  "7z": "7-Zip Archive",
  rar: "RAR Archive",
  jar: "Java Archive",
  iso: "Disk Image",
  dmg: "macOS Disk Image",
};

function getBinaryFileType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return BINARY_TYPE_MAP[ext] || "Binary File";
}

function formatHexLines(data: Uint8Array, maxBytes = 128): string[] {
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

  return lines;
}

interface BinaryPreviewData {
  fileSize: number;
  fileType: string;
  hexLines: string[];
}

function useBinaryPreview(filePath: string | null, enabled: boolean) {
  const [data, setData] = useState<BinaryPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !filePath) {
      setData(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    readFile(filePath)
      .then((bytes) => {
        if (cancelled) return;
        setData({
          fileSize: bytes.length,
          fileType: getBinaryFileType(filePath),
          hexLines: formatHexLines(bytes),
        });
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, filePath]);

  return { data, isLoading };
}

const convertTokensToLineTokens = (content: string, tokens: Token[]): LineData[] => {
  const lines = content.split("\n");
  const sortedTokens = [...tokens].sort((a, b) => a.start - b.start || a.end - b.end);
  if (tokens.length === 0) {
    return lines.map((line, i) => ({
      lineNumber: i + 1,
      content: line,
      tokens: [],
    }));
  }

  const lineData: LineData[] = [];
  let currentPos = 0;
  const lineStarts: number[] = [0];

  for (let i = 0; i < lines.length; i++) {
    currentPos += lines[i].length + 1;
    lineStarts.push(currentPos);
  }

  let tokenIdx = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineStart = lineStarts[lineIndex];
    const lineEnd = lineStart + line.length;
    const lineTokens: LineToken[] = [];

    while (tokenIdx < sortedTokens.length && sortedTokens[tokenIdx].end <= lineStart) {
      tokenIdx++;
    }

    let tempIdx = tokenIdx;
    while (tempIdx < sortedTokens.length && sortedTokens[tempIdx].start < lineEnd) {
      const token = sortedTokens[tempIdx];
      if (token.end > lineStart) {
        const startColumn = Math.max(0, token.start - lineStart);
        const endColumn = Math.min(line.length, token.end - lineStart);
        if (startColumn < endColumn) {
          lineTokens.push({
            startColumn,
            endColumn,
            className: token.class_name,
          });
        }
      }
      tempIdx++;
    }

    lineData.push({
      lineNumber: lineIndex + 1,
      content: line,
      tokens: lineTokens,
    });
  }

  return lineData;
};

const normalizeLineTokens = (tokens: LineToken[], lineLength: number): LineToken[] => {
  if (tokens.length === 0) return [];

  const normalized: LineToken[] = [];
  const sorted = [...tokens].sort(
    (a, b) => a.startColumn - b.startColumn || a.endColumn - b.endColumn,
  );
  let cursor = 0;

  for (const token of sorted) {
    const start = Math.max(0, Math.min(lineLength, token.startColumn));
    const end = Math.max(0, Math.min(lineLength, token.endColumn));
    if (end <= start) continue;

    const clippedStart = Math.max(start, cursor);
    if (end <= clippedStart) continue;

    normalized.push({
      ...token,
      startColumn: clippedStart,
      endColumn: end,
    });
    cursor = end;
  }

  return normalized;
};

const PreviewLine = memo(({ lineNumber, content, tokens }: LineData) => {
  const normalizedTokens = useMemo(
    () => normalizeLineTokens(tokens, content.length),
    [tokens, content.length],
  );

  const rendered = useMemo(() => {
    if (normalizedTokens.length === 0) {
      return <span>{content || "\u00A0"}</span>;
    }

    const elements: React.ReactNode[] = [];
    let lastEnd = 0;

    for (let i = 0; i < normalizedTokens.length; i++) {
      const token = normalizedTokens[i];
      if (token.startColumn > lastEnd) {
        elements.push(<span key={`t-${i}`}>{content.slice(lastEnd, token.startColumn)}</span>);
      }
      elements.push(
        <span key={`k-${i}`} className={token.className}>
          {content.slice(token.startColumn, token.endColumn)}
        </span>,
      );
      lastEnd = token.endColumn;
    }

    if (lastEnd < content.length) {
      elements.push(<span key="e">{content.slice(lastEnd)}</span>);
    }

    return <>{elements}</>;
  }, [content, normalizedTokens]);

  return (
    <div className="flex items-start font-mono text-[11px] leading-[18px]">
      <span className="mr-3 w-8 shrink-0 select-none text-right text-text-lighter tabular-nums opacity-50">
        {lineNumber}
      </span>
      <span className="whitespace-pre text-text">{rendered}</span>
    </div>
  );
});

export const FilePreview = ({ filePath }: FilePreviewProps) => {
  const isImage = !!(filePath && isImageFile(filePath));
  const isBinary = !!(filePath && !isImage && isBinaryFile(filePath));
  const { content, tokens, isLoading, error } = useFilePreview(
    isImage || isBinary ? null : filePath,
  );
  const {
    src: imageSrc,
    isLoading: isImageLoading,
    error: imageError,
  } = useImagePreview(filePath, isImage);
  const { data: binaryData, isLoading: isBinaryLoading } = useBinaryPreview(filePath, isBinary);

  const lineData = useMemo(() => {
    if (!content) return [];
    return convertTokensToLineTokens(content, tokens);
  }, [content, tokens]);

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
        Select a file to preview
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
        Loading preview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
        {error}
      </div>
    );
  }

  if (isImage) {
    if (isImageLoading) {
      return (
        <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
          Loading image preview...
        </div>
      );
    }

    if (imageError) {
      return (
        <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
          {imageError}
        </div>
      );
    }

    if (!imageSrc) {
      return (
        <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
          Unable to preview image
        </div>
      );
    }

    const fileName = filePath?.split(/[\\/]/).pop() || "image";
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-primary-bg p-3">
        <img
          src={imageSrc}
          alt={fileName}
          className="max-h-full max-w-full rounded border border-border object-contain"
        />
      </div>
    );
  }

  if (isBinary) {
    if (isBinaryLoading) {
      return (
        <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
          Loading binary preview...
        </div>
      );
    }

    if (!binaryData) {
      return (
        <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
          Unable to preview binary file
        </div>
      );
    }

    const ext = filePath?.split(".").pop()?.toUpperCase() || "";
    return (
      <div className="h-full overflow-auto bg-primary-bg p-3">
        <div className="mb-3 flex items-center gap-2 rounded border border-border/60 bg-secondary-bg px-3 py-2">
          <FileIcon size={14} className="shrink-0 text-text-lighter" />
          <div className="min-w-0">
            <div className="ui-font truncate text-text text-xs">{binaryData.fileType}</div>
            <div className="ui-font text-[10px] text-text-lighter">
              {formatFileSize(binaryData.fileSize)} {ext && `\u2022 .${ext.toLowerCase()}`}
            </div>
          </div>
        </div>
        <pre className="font-mono text-[10px] text-text-lighter leading-[16px]">
          {binaryData.hexLines.join("\n")}
        </pre>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
        Empty file
      </div>
    );
  }

  return (
    <div className="custom-scrollbar-thin h-full overflow-auto bg-primary-bg p-3">
      <div className="min-w-max space-y-0">
        {lineData.map((line) => (
          <PreviewLine key={line.lineNumber} {...line} />
        ))}
      </div>
    </div>
  );
};
