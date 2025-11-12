/**
 * Gutter Width Utilities
 * Calculate optimal gutter width based on line count
 */

/**
 * Calculate the width needed for line numbers based on total line count
 * @param lineCount - Total number of lines in the document
 * @param charWidth - Width of a single character in pixels (for monospace)
 * @returns Width in pixels needed for the gutter
 */
export function calculateGutterWidth(lineCount: number, charWidth: number = 8.4): number {
  // Calculate how many digits we need
  const digits = Math.max(2, String(lineCount).length);

  // Width = (digits * charWidth) + left padding + right padding
  const leftPadding = 8; // px
  const rightPadding = 16; // px (more space between gutter and code)

  return digits * charWidth + leftPadding + rightPadding;
}

/**
 * Get padding values for line numbers based on gutter width
 * Reserved for future dynamic padding calculations
 */
export function getGutterPadding(_gutterWidth: number): { left: number; right: number } {
  return {
    left: 8,
    right: 16,
  };
}
