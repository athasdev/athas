/**
 * HTML escaping and rendering utilities
 */

export interface Token {
  start: number;
  end: number;
  class_name: string;
}

/**
 * Line offset cache for fast line-to-offset conversions
 */
interface LineOffsetCache {
  offsets: number[];
  contentHash: string;
}

let lineOffsetCache: LineOffsetCache | null = null;

/**
 * Normalize line endings to Unix style (\n)
 * This ensures consistent offset calculations across platforms
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Build a map of line numbers to their starting character offsets
 * This avoids repeated offset calculations during rendering
 * Exported for use in tokenizer and other utilities
 */
export function buildLineOffsetMap(content: string): number[] {
  // Normalize line endings first to ensure consistent offsets
  const normalizedContent = normalizeLineEndings(content);

  // Check cache first
  const contentHash = `${normalizedContent.length}-${normalizedContent.substring(0, 100)}`;
  if (lineOffsetCache && lineOffsetCache.contentHash === contentHash) {
    return lineOffsetCache.offsets;
  }

  const lines = normalizedContent.split("\n");
  const offsets: number[] = new Array(lines.length);
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    offsets[i] = offset;
    offset += lines[i].length + 1; // +1 for newline
  }

  // Cache the result
  lineOffsetCache = { offsets, contentHash };
  return offsets;
}

/**
 * Escape HTML special characters (without converting newlines)
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render a single line with syntax highlighting tokens
 */
function renderLineWithTokens(lineContent: string, tokens: Token[], lineStart: number): string {
  if (tokens.length === 0) {
    return escapeHtml(lineContent);
  }

  let html = "";
  let lastIndex = 0;

  for (const token of tokens) {
    // Calculate token position relative to this line
    const tokenStartInLine = token.start - lineStart;
    const tokenEndInLine = token.end - lineStart;

    // Skip tokens that don't overlap with this line
    if (tokenEndInLine <= 0 || tokenStartInLine >= lineContent.length) {
      continue;
    }

    // Add text before token
    if (tokenStartInLine > lastIndex) {
      const text = escapeHtml(
        lineContent.substring(lastIndex, Math.max(lastIndex, tokenStartInLine)),
      );
      html += text;
    }

    // Add token (clamped to line boundaries)
    const start = Math.max(0, tokenStartInLine);
    const end = Math.min(lineContent.length, tokenEndInLine);
    const tokenText = escapeHtml(lineContent.substring(start, end));
    html += `<span class="${token.class_name}">${tokenText}</span>`;

    lastIndex = end;
  }

  // Add remaining text
  if (lastIndex < lineContent.length) {
    const text = escapeHtml(lineContent.substring(lastIndex));
    html += text;
  }

  return html;
}

/**
 * Render content with syntax highlighting tokens as line-based divs for contenteditable
 */
export function renderWithTokens(content: string, tokens: Token[]): string {
  // Normalize line endings for consistent rendering
  const normalizedContent = normalizeLineEndings(content);
  const lines = normalizedContent.split("\n");
  const sorted = [...tokens].sort((a, b) => a.start - b.start);

  // Use cached line offset map for O(1) lookups instead of O(n) calculations
  const lineOffsets = buildLineOffsetMap(normalizedContent);

  let html = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const offset = lineOffsets[i];
    const lineHtml = renderLineWithTokens(line, sorted, offset);

    // Render each line as a div (what contenteditable expects)
    html += `<div>${lineHtml || "<br>"}</div>`;
  }

  return html;
}
