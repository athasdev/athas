import { getFilenameFromPath } from "../../../file-system/controllers/file-utils";
import type { GitDiff, GitDiffLine } from "../models/git-types";

export function parseRawDiffContent(content: string, filePath: string): GitDiff {
  const lines = content.split("\n");
  const diffLines: GitDiffLine[] = [];
  let currentOldLine = 1;
  let currentNewLine = 1;
  let fileName = getFilenameFromPath(filePath);

  // Remove .diff or .patch extension for display
  fileName = fileName.replace(/\.(diff|patch)$/i, "");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Hunk header: @@ -old_start,old_count +new_start,new_count @@
    if (line.startsWith("@@")) {
      const hunkMatch = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@(.*)?/);
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

    // File headers (ignore for now)
    if (
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("diff ") ||
      line.startsWith("index ")
    ) {
      continue;
    }

    // Added line
    if (line.startsWith("+")) {
      diffLines.push({
        line_type: "added",
        content: line.substring(1), // Remove the + prefix
        old_line_number: undefined,
        new_line_number: currentNewLine,
      });
      currentNewLine++;
    }
    // Removed line
    else if (line.startsWith("-")) {
      diffLines.push({
        line_type: "removed",
        content: line.substring(1), // Remove the - prefix
        old_line_number: currentOldLine,
        new_line_number: undefined,
      });
      currentOldLine++;
    }
    // Context line (unchanged)
    else if (line.startsWith(" ")) {
      diffLines.push({
        line_type: "context",
        content: line.substring(1), // Remove the space prefix
        old_line_number: currentOldLine,
        new_line_number: currentNewLine,
      });
      currentOldLine++;
      currentNewLine++;
    }
    // Empty line or other content
    else if (line.trim()) {
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
    old_path: undefined,
    new_path: undefined,
    is_new: false,
    is_deleted: false,
    is_renamed: false,
    is_binary: false,
    is_image: false,
    old_blob_base64: undefined,
    new_blob_base64: undefined,
    lines: diffLines,
  };
}

export function isDiffFile(path: string, content?: string): boolean {
  // Check by extension
  if (/\.(diff|patch)$/i.test(path)) {
    return true;
  }

  // Check by content if provided
  if (content?.includes("@@")) {
    return true;
  }

  return false;
}
