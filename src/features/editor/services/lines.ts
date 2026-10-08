import { EDITOR_CONSTANTS } from "../config/constants";
import { isMarkdownPreviewableFile } from "../markdown/previewable";

export function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export function calculateLineHeight(
  fontSize: number,
  lineHeight: number = EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER,
): number {
  // Use Math.ceil to match getLineHeight() in position.ts
  // Fractional line-height causes subpixel misalignment between layers
  return Math.ceil(fontSize * lineHeight);
}

export function isMarkdownFile(filePath: string): boolean {
  return isMarkdownPreviewableFile(filePath);
}
