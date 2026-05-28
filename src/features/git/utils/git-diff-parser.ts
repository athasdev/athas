import { getFilenameFromPath } from "@/features/file-system/controllers/file-utils";
import type { MultiFileDiff } from "../types/git-diff-types";
import type { GitDiff, GitDiffLine } from "../types/git-types";
import { countDiffStats } from "./git-diff-helpers";

function stripGitPrefix(path: string): string {
  return path.replace(/^(a|b)\//, "");
}

function normalizeDiffPath(path: string): string | undefined {
  if (!path || path === "/dev/null") return undefined;
  return stripGitPrefix(path);
}

function parseGitDiffPath(line: string): { oldPath?: string; newPath?: string } | null {
  const match = line.match(/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/);
  if (!match) return null;

  return {
    oldPath: normalizeDiffPath(match[1]),
    newPath: normalizeDiffPath(match[2]),
  };
}

function createEmptyDiff(filePath: string): GitDiff {
  return {
    file_path: filePath,
    old_path: undefined,
    new_path: undefined,
    is_new: false,
    is_deleted: false,
    is_renamed: false,
    is_binary: false,
    is_image: false,
    old_blob_base64: undefined,
    new_blob_base64: undefined,
    lines: [],
  };
}

function parseDiffSection(lines: string[], fallbackFilePath: string): GitDiff {
  const diffLines: GitDiffLine[] = [];
  let currentOldLine = 1;
  let currentNewLine = 1;
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let fileName = fallbackFilePath;
  let isNew = false;
  let isDeleted = false;
  let isRenamed = false;
  let isBinary = false;
  let hasSeenHunk = false;

  const firstLinePath = lines[0] ? parseGitDiffPath(lines[0]) : null;
  if (firstLinePath) {
    oldPath = firstLinePath.oldPath;
    newPath = firstLinePath.newPath;
    fileName = newPath ?? oldPath ?? fileName;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const diffPath = parseGitDiffPath(line);
    if (diffPath) {
      oldPath = diffPath.oldPath;
      newPath = diffPath.newPath;
      fileName = newPath ?? oldPath ?? fileName;
      continue;
    }

    if (line.startsWith("new file mode")) {
      isNew = true;
      continue;
    }

    if (line.startsWith("deleted file mode")) {
      isDeleted = true;
      continue;
    }

    if (line.startsWith("rename from ")) {
      oldPath = line.slice("rename from ".length);
      isRenamed = true;
      continue;
    }

    if (line.startsWith("rename to ")) {
      newPath = line.slice("rename to ".length);
      fileName = newPath;
      isRenamed = true;
      continue;
    }

    if (!hasSeenHunk && line.startsWith("--- ")) {
      oldPath = normalizeDiffPath(line.slice(4).trim()) ?? oldPath;
      isNew = line.slice(4).trim() === "/dev/null";
      continue;
    }

    if (!hasSeenHunk && line.startsWith("+++ ")) {
      newPath = normalizeDiffPath(line.slice(4).trim()) ?? newPath;
      isDeleted = line.slice(4).trim() === "/dev/null";
      fileName = newPath ?? oldPath ?? fileName;
      continue;
    }

    if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      isBinary = true;
      continue;
    }

    if (line.startsWith("@@")) {
      hasSeenHunk = true;
      const hunkMatch = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)?/);
      if (hunkMatch) {
        currentOldLine = parseInt(hunkMatch[1]);
        currentNewLine = parseInt(hunkMatch[2]);

        diffLines.push({
          line_type: "header",
          content: line,
          old_line_number: undefined,
          new_line_number: undefined,
        });
      }
      continue;
    }

    if (!hasSeenHunk) {
      continue;
    }

    if (line.startsWith("index ")) {
      continue;
    }

    if (line.startsWith("+")) {
      diffLines.push({
        line_type: "added",
        content: line.substring(1),
        old_line_number: undefined,
        new_line_number: currentNewLine,
      });
      currentNewLine++;
    } else if (line.startsWith("-")) {
      diffLines.push({
        line_type: "removed",
        content: line.substring(1),
        old_line_number: currentOldLine,
        new_line_number: undefined,
      });
      currentOldLine++;
    } else if (line.startsWith(" ")) {
      diffLines.push({
        line_type: "context",
        content: line.substring(1),
        old_line_number: currentOldLine,
        new_line_number: currentNewLine,
      });
      currentOldLine++;
      currentNewLine++;
    } else if (line.trim()) {
      diffLines.push({
        line_type: "context",
        content: line,
        old_line_number: currentOldLine,
        new_line_number: currentNewLine,
      });
      currentOldLine++;
      currentNewLine++;
    }
  }

  return {
    file_path: fileName,
    old_path: oldPath,
    new_path: newPath,
    is_new: isNew,
    is_deleted: isDeleted,
    is_renamed: isRenamed,
    is_binary: isBinary,
    is_image: false,
    old_blob_base64: undefined,
    new_blob_base64: undefined,
    lines: diffLines,
  };
}

export function parseRawDiffContent(content: string, filePath: string): GitDiff | MultiFileDiff {
  const lines = content.split("\n");
  const fallbackFilePath = getFilenameFromPath(filePath).replace(/\.(diff|patch)$/i, "");
  const sections: string[][] = [];
  let currentSection: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (currentSection.length > 0) {
        sections.push(currentSection);
      }
      currentSection = [line];
      continue;
    }

    if (currentSection.length > 0) {
      currentSection.push(line);
    }
  }

  if (currentSection.length > 0) {
    sections.push(currentSection);
  }

  const diffs =
    sections.length > 0
      ? sections.map((section) => parseDiffSection(section, fallbackFilePath))
      : [parseDiffSection(lines, fallbackFilePath)];

  if (diffs.length === 1) {
    return diffs[0] ?? createEmptyDiff(fallbackFilePath);
  }

  const stats = countDiffStats(diffs);

  return {
    title: getFilenameFromPath(filePath),
    commitHash: filePath,
    files: diffs,
    totalFiles: diffs.length,
    totalAdditions: stats.additions,
    totalDeletions: stats.deletions,
    fileKeys: diffs.map((diff) => diff.file_path),
    initiallyExpandedFileKey: diffs[0]?.file_path,
    isLoading: false,
  };
}

export function isDiffFile(path: string, content?: string): boolean {
  if (/\.(diff|patch)$/i.test(path)) {
    return true;
  }

  if (
    content &&
    /^diff --git a\/.+ b\/.+$/m.test(content) &&
    /^--- (?:a\/.+|\/dev\/null)$/m.test(content) &&
    /^\+\+\+ (?:b\/.+|\/dev\/null)$/m.test(content)
  ) {
    return true;
  }

  if (
    content &&
    /^--- .+$/m.test(content) &&
    /^\+\+\+ .+$/m.test(content) &&
    /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(content)
  ) {
    return true;
  }

  return false;
}
