export function splitLines(content: string): string[] {
  return content.split("\n");
}

export function calculateLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.4);
}

export function calculateLineOffset(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).reduce((acc, line) => acc + line.length + 1, 0);
}

export function isMarkdownFile(filePath: string): boolean {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return extension === "md" || extension === "markdown";
}
