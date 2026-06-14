export interface RMarkdownChunk {
  index: number;
  markerLine: number;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  title: string;
  language: string;
  code: string;
  setupCode: string;
}

interface ChunkMarker {
  line: number;
  offset: number;
  endOffset: number;
  title: string;
  language: string;
}

const OPENING_FENCE_PATTERN = /^\s*```\s*(?:\{\s*([A-Za-z0-9_-]+)([^}]*)\}|([A-Za-z0-9_-]+)(.*))$/;
const CLOSING_FENCE_PATTERN = /^\s*```\s*$/;

function lineStartOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function lineEndOffset(content: string, lineStart: number): number {
  const newlineIndex = content.indexOf("\n", lineStart);
  return newlineIndex === -1 ? content.length : newlineIndex + 1;
}

function chunkTitle(language: string, info: string | undefined, index: number): string {
  const trimmed = info?.trim() ?? "";
  const label = trimmed.split(/[\s,]+/).find(Boolean);
  return label || `${language} chunk ${index + 1}`;
}

export function getRMarkdownChunks(content: string): RMarkdownChunk[] {
  const offsets = lineStartOffsets(content);
  const lines = content.split("\n");
  const chunks: RMarkdownChunk[] = [];
  const setupParts: string[] = [];

  for (let line = 0; line < lines.length; line += 1) {
    const match = lines[line].match(OPENING_FENCE_PATTERN);
    if (!match) continue;

    const language = (match[1] ?? match[3] ?? "").toLowerCase();
    if (language !== "r" && language !== "rscript") continue;

    const marker: ChunkMarker = {
      line,
      offset: offsets[line] ?? 0,
      endOffset: lineEndOffset(content, offsets[line] ?? 0),
      title: chunkTitle(language, match[2] ?? match[4], chunks.length),
      language,
    };

    let closeLine = lines.length - 1;
    for (let candidate = line + 1; candidate < lines.length; candidate += 1) {
      if (CLOSING_FENCE_PATTERN.test(lines[candidate])) {
        closeLine = candidate;
        break;
      }
    }

    const closeOffset = offsets[closeLine] ?? content.length;
    const code = content.slice(marker.endOffset, closeOffset).replace(/\s+$/, "");

    chunks.push({
      index: chunks.length,
      markerLine: marker.line,
      startLine: marker.line + 1,
      endLine: Math.max(marker.line + 1, closeLine - 1),
      startOffset: marker.endOffset,
      endOffset: closeOffset,
      title: marker.title,
      language: marker.language,
      code,
      setupCode: setupParts.filter((part) => part.trim().length > 0).join("\n"),
    });

    setupParts.push(code);
    line = closeLine;
  }

  return chunks;
}
