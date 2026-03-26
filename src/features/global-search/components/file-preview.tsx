import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { FileIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { Token } from "@/features/editor/extensions/types";
import type { LineToken } from "@/features/editor/types/editor";
import {
  getDatabaseTypeFromPath,
  isBinaryFile,
  isImageFile,
} from "@/features/file-system/controllers/file-utils";
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

const BINARY_LABEL_BY_EXT: Record<string, string> = {
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
  woff: "Web Font",
  woff2: "Web Font",
  ttf: "TrueType Font",
  otf: "OpenType Font",
  zip: "ZIP Archive",
  tar: "Tape Archive",
  gz: "Gzip Archive",
  "7z": "7-Zip Archive",
  rar: "RAR Archive",
  jar: "Java Archive",
  iso: "Disk Image",
  dmg: "macOS Disk Image",
  sqlite: "SQLite Database",
  sqlite3: "SQLite Database",
  db: "SQLite Database",
};

function getBinaryFileLabel(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return BINARY_LABEL_BY_EXT[ext] || "Binary File";
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
    <div className="ui-text-sm flex items-start font-mono leading-[18px]">
      <span className="sticky left-0 z-10 mr-3 inline-block w-8 shrink-0 select-none bg-primary-bg px-3 text-right text-text-lighter/50 tabular-nums">
        {lineNumber}
      </span>
      <span className="whitespace-pre text-text">{rendered}</span>
    </div>
  );
});

export const FilePreview = ({ filePath }: FilePreviewProps) => {
  const isImage = !!(filePath && isImageFile(filePath));
  const isBinary = !!(
    filePath &&
    !isImage &&
    (isBinaryFile(filePath) || getDatabaseTypeFromPath(filePath))
  );
  const { content, tokens, isLoading, error } = useFilePreview(
    isImage || isBinary ? null : filePath,
  );
  const {
    src: imageSrc,
    isLoading: isImageLoading,
    error: imageError,
  } = useImagePreview(filePath, isImage);

  const lineData = useMemo(() => {
    if (!content) return [];
    return convertTokensToLineTokens(content, tokens);
  }, [content, tokens]);

  if (!filePath) {
    return (
      <div className="ui-text-sm flex h-full items-center justify-center p-4 text-center text-text-lighter">
        Select a file to preview
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="ui-text-sm flex h-full items-center justify-center p-4 text-center text-text-lighter">
        Loading preview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="ui-text-sm flex h-full items-center justify-center p-4 text-center text-text-lighter">
        {error}
      </div>
    );
  }

  if (isImage) {
    if (isImageLoading) {
      return (
        <div className="ui-text-sm flex h-full items-center justify-center p-4 text-center text-text-lighter">
          Loading image preview...
        </div>
      );
    }

    if (imageError) {
      return (
        <div className="ui-text-sm flex h-full items-center justify-center p-4 text-center text-text-lighter">
          {imageError}
        </div>
      );
    }

    if (!imageSrc) {
      return (
        <div className="ui-text-sm flex h-full items-center justify-center p-4 text-center text-text-lighter">
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
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 p-4 text-center">
        <FileIcon className="text-text-lighter" />
        <span className="ui-font ui-text-sm text-text-lighter">{getBinaryFileLabel(filePath)}</span>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="ui-text-sm flex h-full items-center justify-center p-4 text-center text-text-lighter">
        Empty file
      </div>
    );
  }

  return (
    <div className="custom-scrollbar-thin h-full overflow-y-auto overflow-x-hidden bg-primary-bg py-3 pr-3">
      <div className="space-y-0">
        {lineData.map((line) => (
          <PreviewLine key={line.lineNumber} {...line} />
        ))}
      </div>
    </div>
  );
};
