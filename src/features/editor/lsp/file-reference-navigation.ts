import { getDirName, joinPath } from "@/utils/path-helpers";

export interface FileReferenceRange {
  line: number;
  startColumn: number;
  endColumn: number;
}

export interface FileReference {
  rawPath: string;
  lookupPath: string;
  targetPath: string;
  range: FileReferenceRange;
}

function getLineText(content: string, line: number): string | null {
  if (line < 0) return null;

  let currentLine = 0;
  let lineStart = 0;
  while (currentLine < line) {
    const nextNewline = content.indexOf("\n", lineStart);
    if (nextNewline === -1) return null;
    lineStart = nextNewline + 1;
    currentLine++;
  }

  const lineEnd = content.indexOf("\n", lineStart);
  return lineEnd === -1 ? content.slice(lineStart) : content.slice(lineStart, lineEnd);
}

function stripFileReferenceSuffix(value: string): string {
  const suffixIndex = value.search(/[?#]/);
  return suffixIndex === -1 ? value : value.slice(0, suffixIndex);
}

function decodeFileReference(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeResolvedPath(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const driveMatch = normalizedPath.match(/^([A-Za-z]:)(\/.*)?$/);
  const protocolMatch = normalizedPath.match(/^([A-Za-z][A-Za-z\d+.-]*:\/\/[^/]*)(\/.*)?$/);
  const prefix = driveMatch?.[1] ?? protocolMatch?.[1] ?? (normalizedPath.startsWith("/") ? "/" : "");
  const body = driveMatch?.[2] ?? protocolMatch?.[2] ?? normalizedPath;
  const segments = body.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== "..") {
        resolved.pop();
      } else if (!prefix) {
        resolved.push(segment);
      }
      continue;
    }
    resolved.push(segment);
  }

  if (prefix === "/") return `/${resolved.join("/")}`;
  if (prefix) return `${prefix}${resolved.length > 0 ? "/" : ""}${resolved.join("/")}`;
  return resolved.join("/");
}

function isExternalReference(value: string): boolean {
  if (!value || value.startsWith("#") || value.startsWith("//")) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(value);
}

function resolveReferencePath(
  rawPath: string,
  sourceFilePath: string,
  rootFolderPath?: string,
): { lookupPath: string; targetPath: string } | null {
  if (isExternalReference(rawPath)) return null;

  const lookupPath = decodeFileReference(stripFileReferenceSuffix(rawPath.trim()));
  if (!lookupPath || isExternalReference(lookupPath)) return null;

  if (/^[A-Za-z]:[\\/]/.test(lookupPath)) {
    return { lookupPath, targetPath: lookupPath };
  }

  if (lookupPath.startsWith("/")) {
    const basePath = rootFolderPath || getDirName(sourceFilePath);
    if (!basePath) return null;
    return { lookupPath, targetPath: normalizeResolvedPath(joinPath(basePath, lookupPath)) };
  }

  const sourceDirPath = getDirName(sourceFilePath);
  if (!sourceDirPath) return null;

  return { lookupPath, targetPath: normalizeResolvedPath(joinPath(sourceDirPath, lookupPath)) };
}

export function getFileReferenceAtPosition({
  content,
  sourceFilePath,
  rootFolderPath,
  line,
  column,
}: {
  content: string;
  sourceFilePath: string;
  rootFolderPath?: string;
  line: number;
  column: number;
}): FileReference | null {
  if (!sourceFilePath || column < 0) return null;

  const lineText = getLineText(content, line);
  if (!lineText) return null;

  const quotedValue = /(["'`])([^"'`]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = quotedValue.exec(lineText))) {
    const rawPath = match[2];
    const startColumn = match.index + 1;
    const endColumn = startColumn + rawPath.length;
    if (column < startColumn || column > endColumn) continue;

    const resolvedPath = resolveReferencePath(rawPath, sourceFilePath, rootFolderPath);
    if (!resolvedPath) return null;

    return {
      rawPath,
      ...resolvedPath,
      range: {
        line,
        startColumn,
        endColumn,
      },
    };
  }

  return null;
}
