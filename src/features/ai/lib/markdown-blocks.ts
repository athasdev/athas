interface MarkdownBlock {
  /** Line the block starts on in the whole text; stable while text is appended after it. */
  startLine: number;
  text: string;
}

/**
 * Splits markdown at blank lines outside code fences. The transcript renderer resets all of its
 * state at such a line, so each block renders the same on its own, and a streamed reply only
 * changes its last block while everything before it stays as it was.
 */
export function splitMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let lines: string[] = [];
  let startLine = 0;
  let inFence = false;

  const flush = () => {
    if (lines.length > 0) blocks.push({ startLine, text: lines.join("\n") });
    lines = [];
  };

  text.split("\n").forEach((line, index) => {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      flush();
      return;
    }
    if (lines.length === 0) startLine = index;
    lines.push(line);
  });
  flush();

  return blocks;
}
