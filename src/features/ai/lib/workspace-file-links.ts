import type { FileEntry } from "@/features/file-system/types/app.types";
import {
  getBaseName,
  getRelativePath,
  joinPath,
  normalizePath,
  pathStartsWithRoot,
  stripTrailingPathSeparators,
} from "@/utils/path-helpers";

export interface WorkspaceFileLinkTarget {
  path: string;
  line?: number;
  column?: number;
}

interface ParsedFileLinkCandidate {
  path: string;
  line?: number;
  column?: number;
}

const EXTERNAL_PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const LINE_HASH_PATTERN = /(?:#L|#line-?)(\d+)(?:[,-]L?(\d+))?$/i;
const LINE_SUFFIX_PATTERN = /:(\d+)(?::(\d+))?$/;

export function isExternalMarkdownLink(href: string): boolean {
  const trimmed = href.trim();
  return (
    EXTERNAL_PROTOCOL_PATTERN.test(trimmed) &&
    !trimmed.startsWith("file://") &&
    !trimmed.startsWith("remote://") &&
    !trimmed.startsWith("wsl://")
  );
}

function decodeLinkValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseFileLinkCandidate(rawValue: string): ParsedFileLinkCandidate | null {
  let value = decodeLinkValue(rawValue)
    .trim()
    .replace(/^<|>$/g, "")
    .replace(/^file:\/\//, "");

  if (!value || value.startsWith("#") || isExternalMarkdownLink(value)) return null;

  const queryIndex = value.indexOf("?");
  if (queryIndex >= 0) {
    value = value.slice(0, queryIndex);
  }

  let line: number | undefined;
  let column: number | undefined;
  const hashLineMatch = value.match(LINE_HASH_PATTERN);
  if (hashLineMatch) {
    line = Number(hashLineMatch[1]);
    value = value.slice(0, hashLineMatch.index);
  } else {
    const suffixLineMatch = value.match(LINE_SUFFIX_PATTERN);
    if (suffixLineMatch && !/^[A-Za-z]:\d+$/.test(value)) {
      line = Number(suffixLineMatch[1]);
      column = suffixLineMatch[2] ? Number(suffixLineMatch[2]) : undefined;
      value = value.slice(0, suffixLineMatch.index);
    } else {
      const hashIndex = value.indexOf("#");
      if (hashIndex >= 0) {
        value = value.slice(0, hashIndex);
      }
    }
  }

  value = normalizePath(stripTrailingPathSeparators(value.replace(/^\.\//, "")));
  if (!value || value === ".") return null;

  return {
    path: value,
    line: line && Number.isFinite(line) && line > 0 ? line : undefined,
    column: column && Number.isFinite(column) && column > 0 ? column : undefined,
  };
}

function scoreFileMatch(file: FileEntry, candidatePath: string, rootFolderPath?: string | null) {
  const filePath = normalizePath(file.path);
  const relativePath = normalizePath(getRelativePath(file.path, rootFolderPath));
  const fileName = getBaseName(file.path);
  const normalizedCandidate = normalizePath(candidatePath).replace(/^\/+/, "");

  if (filePath === normalizedCandidate) return 0;
  if (rootFolderPath) {
    const absoluteCandidate = normalizePath(joinPath(rootFolderPath, normalizedCandidate));
    if (filePath === absoluteCandidate) return 1;
  }
  if (relativePath === normalizedCandidate) return 2;
  if (relativePath.endsWith(`/${normalizedCandidate}`)) return 3;
  if (fileName === normalizedCandidate) return 4;
  if (fileName.toLowerCase() === normalizedCandidate.toLowerCase()) return 5;

  return Number.POSITIVE_INFINITY;
}

export function resolveWorkspaceFileLink(
  href: string,
  label: string,
  files: FileEntry[],
  rootFolderPath?: string | null,
): WorkspaceFileLinkTarget | null {
  if (isExternalMarkdownLink(href)) return null;

  const candidates = [href, label]
    .map(parseFileLinkCandidate)
    .filter((candidate): candidate is ParsedFileLinkCandidate => Boolean(candidate));

  for (const candidate of candidates) {
    if (
      rootFolderPath &&
      pathStartsWithRoot(candidate.path, rootFolderPath) &&
      files.some((file) => normalizePath(file.path) === normalizePath(candidate.path))
    ) {
      return candidate;
    }

    const matches = files
      .filter((file) => !file.isDir)
      .map((file) => ({
        file,
        score: scoreFileMatch(file, candidate.path, rootFolderPath),
      }))
      .filter((match) => Number.isFinite(match.score))
      .sort((a, b) => a.score - b.score || a.file.path.length - b.file.path.length);

    if (matches.length > 0) {
      return {
        path: matches[0].file.path,
        line: candidate.line,
        column: candidate.column,
      };
    }
  }

  return null;
}
