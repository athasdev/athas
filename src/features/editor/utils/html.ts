/**
 * HTML escaping and rendering utilities
 */

export interface Token {
  start: number;
  end: number;
  class_name: string;
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
  const lines = content.split("\n");
  const sorted = [...tokens].sort((a, b) => a.start - b.start);

  let html = "";
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineHtml = renderLineWithTokens(line, sorted, offset);

    // Render each line as a div (what contenteditable expects)
    html += `<div>${lineHtml || "<br>"}</div>`;

    // Update offset (add 1 for the \n character)
    offset += line.length + 1;
  }

  return html;
}
