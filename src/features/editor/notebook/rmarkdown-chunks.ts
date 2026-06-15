export interface RMarkdownChunkOptions {
  label?: string;
  eval?: boolean;
  include?: boolean;
  echo?: boolean;
  warning?: boolean;
  message?: boolean;
  results?: string;
  error?: boolean;
}

export interface RMarkdownChunk {
  index: number;
  markerLine: number;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  closeEndOffset: number;
  outputStartOffset: number | null;
  outputEndOffset: number | null;
  title: string;
  language: string;
  options: RMarkdownChunkOptions;
  code: string;
  setupCode: string;
}

interface ChunkMarker {
  line: number;
  offset: number;
  endOffset: number;
  title: string;
  language: string;
  options: RMarkdownChunkOptions;
}

const OPENING_FENCE_PATTERN = /^\s*```\s*(?:\{\s*([A-Za-z0-9_-]+)([^}]*)\}|([A-Za-z0-9_-]+)(.*))$/;
const CLOSING_FENCE_PATTERN = /^\s*```\s*$/;
const ATHAS_OUTPUT_START_PATTERN = /^\s*<!--\s*athas:r-output:start\b.*-->\s*$/;
const ATHAS_OUTPUT_END_PATTERN = /^\s*<!--\s*athas:r-output:end\s*-->\s*$/;

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

function splitChunkOptions(info: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let index = 0; index < info.length; index += 1) {
    const character = info[index];
    if ((character === "'" || character === '"') && info[index - 1] !== "\\") {
      quote = quote === character ? null : quote || character;
      current += character;
      continue;
    }

    if (character === "," && !quote) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseChunkOptionValue(value: string): string | number | boolean {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  if (normalized === "true" || normalized === "t") return true;
  if (normalized === "false" || normalized === "f") return false;
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }

  const numericValue = Number(trimmed);
  if (!Number.isNaN(numericValue) && trimmed !== "") return numericValue;
  return trimmed;
}

function parseChunkOptions(info: string | undefined): RMarkdownChunkOptions {
  const options: RMarkdownChunkOptions = {};
  const parts = splitChunkOptions(info?.trim() ?? "");

  for (const part of parts) {
    const equalsIndex = part.indexOf("=");
    if (equalsIndex === -1) {
      if (!options.label && part.trim()) options.label = part.trim();
      continue;
    }

    const key = part.slice(0, equalsIndex).trim().toLowerCase();
    const value = parseChunkOptionValue(part.slice(equalsIndex + 1));

    if (key === "label" && typeof value === "string") options.label = value;
    if (key === "eval" && typeof value === "boolean") options.eval = value;
    if (key === "include" && typeof value === "boolean") options.include = value;
    if (key === "echo" && typeof value === "boolean") options.echo = value;
    if (key === "warning" && typeof value === "boolean") options.warning = value;
    if (key === "message" && typeof value === "boolean") options.message = value;
    if (key === "results") options.results = String(value).toLowerCase();
    if (key === "error" && typeof value === "boolean") options.error = value;
  }

  return options;
}

function chunkTitle(language: string, options: RMarkdownChunkOptions, index: number): string {
  return options.label || `${language} chunk ${index + 1}`;
}

function findOutputRange(
  content: string,
  lines: string[],
  offsets: number[],
  closeLine: number,
): { startOffset: number; endOffset: number } | null {
  for (let line = closeLine + 1; line < lines.length; line += 1) {
    if (lines[line].trim() === "") continue;
    if (!ATHAS_OUTPUT_START_PATTERN.test(lines[line])) return null;

    for (let endLine = line + 1; endLine < lines.length; endLine += 1) {
      if (ATHAS_OUTPUT_END_PATTERN.test(lines[endLine])) {
        return {
          startOffset: offsets[line] ?? content.length,
          endOffset: lineEndOffset(content, offsets[endLine] ?? content.length),
        };
      }
    }

    return null;
  }

  return null;
}

function outputFenceFor(value: string): string {
  const matches = value.match(/`{3,}/g) ?? [];
  const longest = matches.reduce((max, match) => Math.max(max, match.length), 3);
  return "`".repeat(longest + 1);
}

export function formatRMarkdownChunkOutput(output: {
  stdout?: string;
  stderr?: string;
  status?: number | null;
  timedOut?: boolean;
}): string {
  const sections: string[] = [];
  if (output.stdout?.trim()) sections.push(output.stdout.trimEnd());

  if (output.stderr?.trim()) {
    sections.push(`stderr:\n${output.stderr.trimEnd()}`);
  } else if (output.timedOut) {
    sections.push("stderr:\nR chunk execution timed out.");
  } else if (output.status !== 0 && output.status !== null && output.status !== undefined) {
    sections.push(`stderr:\nR exited with status ${output.status}.`);
  }

  const body = sections.length > 0 ? sections.join("\n\n") : "R chunk ran with no output.";
  const fence = outputFenceFor(body);

  return [
    "<!-- athas:r-output:start -->",
    `${fence}text`,
    body,
    fence,
    "<!-- athas:r-output:end -->",
    "",
  ].join("\n");
}

export function rMarkdownChunkShouldEvaluate(chunk: RMarkdownChunk): boolean {
  return chunk.options.eval !== false;
}

export function rMarkdownChunkShouldPersistOutput(chunk: RMarkdownChunk): boolean {
  return chunk.options.include !== false;
}

export function applyRMarkdownChunkOptionSemantics(
  output: {
    stdout: string;
    stderr: string;
    status: number | null;
    timedOut: boolean;
  },
  chunk: RMarkdownChunk,
): {
  stdout: string;
  stderr: string;
  status: number | null;
  timedOut: boolean;
} {
  const statusIndicatesError = output.status !== 0 && output.status !== null;
  const hideStdout = chunk.options.results === "hide";
  let stderr = output.stderr;

  if (!statusIndicatesError && chunk.options.message === false) {
    stderr = "";
  } else if (!statusIndicatesError && chunk.options.warning === false) {
    stderr = /^\s*Warning( message| messages)?:/m.test(stderr) ? "" : stderr;
  }

  return {
    ...output,
    stdout: hideStdout ? "" : output.stdout,
    stderr,
  };
}

export function clearRMarkdownChunkOutput(content: string, chunk: RMarkdownChunk): string {
  if (chunk.outputStartOffset === null || chunk.outputEndOffset === null) return content;
  return `${content.slice(0, chunk.outputStartOffset)}${content.slice(chunk.outputEndOffset)}`;
}

export function updateRMarkdownChunkOutput(
  content: string,
  chunk: RMarkdownChunk,
  output: string,
): string {
  const nextOutput = output.endsWith("\n") ? output : `${output}\n`;
  const insertOffset = chunk.closeEndOffset;

  if (chunk.outputStartOffset !== null && chunk.outputEndOffset !== null) {
    return `${content.slice(0, chunk.outputStartOffset)}${nextOutput}${content.slice(
      chunk.outputEndOffset,
    )}`;
  }

  const prefix = insertOffset > 0 && content[insertOffset - 1] !== "\n" ? "\n" : "";
  return `${content.slice(0, insertOffset)}${prefix}${nextOutput}${content.slice(insertOffset)}`;
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
      options: parseChunkOptions(match[2] ?? match[4]),
      title: "",
      language,
    };
    marker.title = chunkTitle(language, marker.options, chunks.length);

    let closeLine = lines.length - 1;
    for (let candidate = line + 1; candidate < lines.length; candidate += 1) {
      if (CLOSING_FENCE_PATTERN.test(lines[candidate])) {
        closeLine = candidate;
        break;
      }
    }

    const closeOffset = offsets[closeLine] ?? content.length;
    const closeEndOffset = lineEndOffset(content, closeOffset);
    const outputRange = findOutputRange(content, lines, offsets, closeLine);
    const code = content.slice(marker.endOffset, closeOffset).replace(/\s+$/, "");

    chunks.push({
      index: chunks.length,
      markerLine: marker.line,
      startLine: marker.line + 1,
      endLine: Math.max(marker.line + 1, closeLine - 1),
      startOffset: marker.endOffset,
      endOffset: closeOffset,
      closeEndOffset,
      outputStartOffset: outputRange?.startOffset ?? null,
      outputEndOffset: outputRange?.endOffset ?? null,
      title: marker.title,
      language: marker.language,
      options: marker.options,
      code,
      setupCode: setupParts.filter((part) => part.trim().length > 0).join("\n"),
    });

    setupParts.push(code);
    line = closeLine;
  }

  return chunks;
}
