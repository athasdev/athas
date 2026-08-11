import type { GitBlameLine } from "../types/git.types";

export function findGitBlameLine(
  lines: readonly GitBlameLine[],
  lineNumber: number,
): GitBlameLine | null {
  let low = 0;
  let high = lines.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const line = lines[middle];
    const start = line.line_number;
    const end = start + line.total_lines - 1;

    if (lineNumber < start) {
      high = middle - 1;
    } else if (lineNumber > end) {
      low = middle + 1;
    } else {
      return line;
    }
  }

  return null;
}
