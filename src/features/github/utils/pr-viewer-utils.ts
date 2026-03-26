import type { ReactNode } from "react";
import { createElement } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { HighlightToken } from "@/features/editor/lib/wasm-parser/types";
import { toast } from "@/ui/toast";
import type { Commit, DiffSectionIndex, FileDiff, FilePatchData } from "../types/pr-viewer";
import type { PullRequestFile } from "../types/github";

export const EXPAND_ALL_EAGER_PATCH_LIMIT = 10;
export const EXPANDED_PATCH_BACKGROUND_BATCH = 4;

export function inferFileStatus(additions: number, deletions: number): FileDiff["status"] {
  if (additions > 0 && deletions === 0) return "added";
  if (deletions > 0 && additions === 0) return "deleted";
  return "modified";
}

export function toFileDiffFromMetadata(file: PullRequestFile): FileDiff {
  const path = typeof file.path === "string" ? file.path.trim() : "";
  return {
    path,
    additions: Number.isFinite(file.additions) ? file.additions : 0,
    deletions: Number.isFinite(file.deletions) ? file.deletions : 0,
    status: inferFileStatus(
      Number.isFinite(file.additions) ? file.additions : 0,
      Number.isFinite(file.deletions) ? file.deletions : 0,
    ),
  };
}

export function buildDiffSectionIndex(diffText: string): DiffSectionIndex {
  if (!diffText) return {};

  const headerRegex = /^diff --git a\/(.+?) b\/(.+)$/gm;
  const headers: Array<
    Pick<import("../types/pr-viewer").DiffSectionRef, "start" | "oldPath" | "newPath">
  > = [];
  for (let match = headerRegex.exec(diffText); match !== null; match = headerRegex.exec(diffText)) {
    headers.push({
      start: match.index,
      oldPath: match[1],
      newPath: match[2],
    });
  }

  if (headers.length === 0) return {};

  const index: DiffSectionIndex = {};
  for (let i = 0; i < headers.length; i += 1) {
    const current = headers[i];
    const next = headers[i + 1];
    const sectionRef = {
      start: current.start,
      end: next ? next.start : diffText.length,
      oldPath: current.oldPath,
      newPath: current.newPath,
    };

    if (!index[current.newPath]) {
      index[current.newPath] = sectionRef;
    }
    if (current.oldPath !== current.newPath && !index[current.oldPath]) {
      index[current.oldPath] = sectionRef;
    }
  }

  return index;
}

export function extractFilePatch(
  diffText: string,
  targetPath: string,
  sectionIndex: DiffSectionIndex,
): FilePatchData | null {
  if (!diffText || !targetPath) return null;
  const sectionRef = sectionIndex[targetPath];
  if (!sectionRef) return null;

  const section = diffText.slice(sectionRef.start, sectionRef.end);

  const lines = section.split("\n");
  if (lines.length === 0) return null;

  const oldPath = sectionRef.oldPath;
  const newPath = sectionRef.newPath;
  const patchLines: string[] = [];
  let status: FileDiff["status"] = oldPath !== newPath ? "renamed" : "modified";
  let inPatch = false;

  for (const line of lines.slice(1)) {
    if (line.startsWith("new file mode")) {
      status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      status = "deleted";
      continue;
    }
    if (line.startsWith("@@")) {
      inPatch = true;
      patchLines.push(line);
      continue;
    }
    if (inPatch) {
      patchLines.push(line);
    }
  }

  return {
    path: newPath,
    oldPath: oldPath !== newPath ? oldPath : undefined,
    status,
    lines: patchLines,
  };
}

export function resolveSafeRepoFilePath(repoPath: string, relativePath: string): string | null {
  const normalizedBase = repoPath.replace(/[\\/]$/, "");
  const normalizedInput = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalizedBase || !normalizedInput) return null;
  if (/^[A-Za-z]:/.test(normalizedInput) || normalizedInput.startsWith("//")) return null;

  const segments = normalizedInput.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))
  ) {
    return null;
  }

  const separator = normalizedBase.includes("\\") ? "\\" : "/";
  return `${normalizedBase}${separator}${segments.join(separator)}`;
}

export function getCommentKey(comment: {
  author: { login: string };
  createdAt: string;
  body: string;
}): string {
  return `${comment.author.login}:${comment.createdAt}:${comment.body.slice(0, 32)}`;
}

export function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeCommitAuthor(value: unknown): Commit["authors"][number] | null {
  const record = asRecord(value);
  if (!record) return null;

  return {
    login: asNonEmptyString(record.login) ?? "",
    name: asNonEmptyString(record.name) ?? "",
    email: asNonEmptyString(record.email) ?? "",
  };
}

export function normalizeCommit(raw: unknown, index: number): Commit | null {
  const record = asRecord(raw);
  if (!record) return null;

  const oid =
    asNonEmptyString(record.oid) ??
    asNonEmptyString(record.sha) ??
    asNonEmptyString(record.id) ??
    `commit-${index + 1}`;

  const fullMessage = asNonEmptyString(record.message) ?? "";
  const firstMessageLine = fullMessage.split("\n")[0]?.trim();
  const messageHeadline =
    asNonEmptyString(record.messageHeadline) ??
    asNonEmptyString(record.title) ??
    firstMessageLine ??
    oid.slice(0, 7);

  const messageBody =
    asNonEmptyString(record.messageBody) ??
    (fullMessage.includes("\n") ? fullMessage.split("\n").slice(1).join("\n").trim() : "");

  const authoredDate =
    asNonEmptyString(record.authoredDate) ??
    asNonEmptyString(record.committedDate) ??
    asNonEmptyString(record.committedAt) ??
    asNonEmptyString(record.createdAt) ??
    new Date().toISOString();

  const authorsField = record.authors;
  const authorsRecord = asRecord(authorsField);
  const rawAuthors = (Array.isArray(authorsField) ? authorsField : null) ??
    (authorsRecord && Array.isArray(authorsRecord.nodes) ? authorsRecord.nodes : null) ?? [
      record.author,
    ];
  const normalizedAuthors = rawAuthors
    .map(normalizeCommitAuthor)
    .filter((author): author is Commit["authors"][number] => !!author);

  return {
    oid,
    messageHeadline,
    messageBody,
    authoredDate,
    url: asNonEmptyString(record.url) ?? undefined,
    authors: normalizedAuthors,
  };
}

export async function copyToClipboard(value: string, successMessage: string) {
  try {
    await writeText(value);
    toast.success(successMessage);
  } catch {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard API is unavailable.");
      }
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch (error) {
      toast.error(`Failed to copy: ${String(error)}`);
    }
  }
}

export function renderTokenizedContent(content: string, tokens: HighlightToken[]): ReactNode[] {
  if (!content || tokens.length === 0) {
    return [content];
  }

  const sortedTokens = [...tokens].sort((a, b) => {
    const startDiff = a.startPosition.column - b.startPosition.column;
    if (startDiff !== 0) return startDiff;
    const aSize = a.endPosition.column - a.startPosition.column;
    const bSize = b.endPosition.column - b.startPosition.column;
    return aSize - bSize;
  });

  const result: ReactNode[] = [];
  let currentPos = 0;

  for (const token of sortedTokens) {
    const start = token.startPosition.column;
    const end = token.endPosition.column;

    if (start >= content.length) continue;
    if (start < currentPos) continue;

    if (start > currentPos) {
      result.push(content.slice(currentPos, start));
    }

    const tokenEnd = Math.min(end, content.length);
    if (tokenEnd > start) {
      const tokenText = content.slice(start, tokenEnd);
      if (token.type === "token-text") {
        result.push(tokenText);
      } else {
        result.push(
          createElement("span", { key: `${start}-${tokenEnd}`, className: token.type }, tokenText),
        );
      }
    }

    currentPos = Math.max(currentPos, tokenEnd);
  }

  if (currentPos < content.length) {
    result.push(content.slice(currentPos));
  }

  return result;
}
