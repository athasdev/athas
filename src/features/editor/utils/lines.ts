import { EDITOR_CONSTANTS } from "../config/constants";

export function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export function calculateLineHeight(fontSize: number): number {
  // Use Math.ceil to match getLineHeight() in position.ts
  // Fractional line-height causes subpixel misalignment between layers
  return Math.ceil(fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);
}

export function calculateLineOffset(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).reduce((acc, line) => acc + line.length + 1, 0);
}

export function isMarkdownFile(filePath: string): boolean {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return extension === "md" || extension === "markdown";
}
