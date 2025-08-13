export interface ColorMatch {
  value: string; // Original color string from the code
  normalizedValue: string; // Normalized hex color for display
  start: number; // Start position in the text
  end: number; // End position in the text
  line: number; // Line number (0-indexed)
  column: number; // Column position within the line
}

/**
 * Converts various color formats to hex format for consistent display
 */
function normalizeColor(colorValue: string): string | null {
  // Create a temporary div to let the browser parse the color
  const div = document.createElement("div");
  div.style.color = colorValue;
  document.body.appendChild(div);

  const computedColor = window.getComputedStyle(div).color;
  document.body.removeChild(div);

  // If browser couldn't parse it, return null
  if (
    !computedColor ||
    (computedColor === "rgb(0, 0, 0)" &&
      colorValue !== "black" &&
      colorValue !== "#000" &&
      colorValue !== "#000000")
  ) {
    return null;
  }

  // Convert rgb/rgba to hex
  const rgbMatch = computedColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `#${Number(r).toString(16).padStart(2, "0")}${Number(g).toString(16).padStart(2, "0")}${Number(b).toString(16).padStart(2, "0")}`;
  }

  return null;
}

/**
 * Detects CSS color values in text and returns their positions and normalized values
 */
export function detectColors(text: string): ColorMatch[] {
  const colors: ColorMatch[] = [];
  const lines = text.split("\n");

  // Regex patterns for different color formats
  const patterns = [
    // Hex colors (#fff, #ffffff, #123abc)
    /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g,

    // RGB/RGBA functions
    /rgba?\(\s*(\d+(?:\.\d+)?%?)\s*,\s*(\d+(?:\.\d+)?%?)\s*,\s*(\d+(?:\.\d+)?%?)\s*(?:,\s*([\d.]+))?\s*\)/g,

    // HSL/HSLA functions
    /hsla?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?%)\s*,\s*(\d+(?:\.\d+)?%)\s*(?:,\s*([\d.]+))?\s*\)/g,

    // CSS named colors (basic set)
    /\b(red|green|blue|white|black|yellow|cyan|magenta|silver|gray|maroon|olive|lime|aqua|teal|navy|fuchsia|purple|orange|pink|brown|gold|violet|indigo|turquoise|tan|salmon|coral|crimson|darkblue|darkgreen|darkred|lightblue|lightgreen|lightgray|darkgray|lightcyan|lightpink|lightyellow|darkviolet|darkorange|darkgoldenrod|lightsteelblue|mediumblue|mediumseagreen)\b/g,
  ];

  let totalOffset = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineStartOffset = totalOffset;

    for (const pattern of patterns) {
      pattern.lastIndex = 0; // Reset regex state
      let match: RegExpExecArray | null;

      match = pattern.exec(line);
      while (match !== null) {
        const colorValue = match[0];
        const normalizedValue = normalizeColor(colorValue);

        if (normalizedValue) {
          colors.push({
            value: colorValue,
            normalizedValue,
            start: lineStartOffset + match.index,
            end: lineStartOffset + match.index + colorValue.length,
            line: lineIndex,
            column: match.index,
          });
        }

        // Prevent infinite loop on zero-width matches
        if (match.index === pattern.lastIndex) {
          pattern.lastIndex++;
        }

        match = pattern.exec(line);
      }
    }

    totalOffset += line.length + 1; // +1 for newline character
  }

  // Sort by position in text
  return colors.sort((a, b) => a.start - b.start);
}

/**
 * Utility to check if a position is within a color match
 */
export function getColorAtPosition(colors: ColorMatch[], position: number): ColorMatch | null {
  return colors.find((color) => position >= color.start && position < color.end) || null;
}
