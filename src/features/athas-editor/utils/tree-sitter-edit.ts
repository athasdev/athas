/**
 * Tree-sitter Edit Calculation Utility
 * Calculates the Edit object needed for incremental parsing
 */

import type { Edit, Point } from "web-tree-sitter";

/**
 * Convert a byte offset to a Point (row, column)
 */
export function offsetToPoint(content: string, offset: number): Point {
  let row = 0;
  let column = 0;

  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") {
      row++;
      column = 0;
    } else {
      column++;
    }
  }

  return { row, column };
}

/**
 * Find the length of the common prefix between two strings
 */
function findCommonPrefixLength(a: string, b: string): number {
  const minLength = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLength && a[i] === b[i]) {
    i++;
  }
  return i;
}

/**
 * Find the length of the common suffix between two strings,
 * starting after a given offset (to avoid overlapping with prefix)
 */
function findCommonSuffixLength(a: string, b: string, prefixLength: number): number {
  const maxSuffixA = a.length - prefixLength;
  const maxSuffixB = b.length - prefixLength;
  const maxSuffix = Math.min(maxSuffixA, maxSuffixB);

  let i = 0;
  while (i < maxSuffix && a[a.length - 1 - i] === b[b.length - 1 - i]) {
    i++;
  }
  return i;
}

/**
 * Calculate the Tree-sitter Edit object from old and new content.
 *
 * Returns null if:
 * - Content hasn't changed
 * - Edit calculation fails for any reason
 *
 * @param oldContent The previous content
 * @param newContent The new content after the edit
 * @returns Edit object for Tree-sitter, or null if calculation fails
 */
export function calculateEdit(oldContent: string, newContent: string): Edit | null {
  // If content is the same, no edit needed
  if (oldContent === newContent) {
    return null;
  }

  // Find common prefix
  const prefixLength = findCommonPrefixLength(oldContent, newContent);

  // Find common suffix (after prefix to avoid overlap)
  const suffixLength = findCommonSuffixLength(oldContent, newContent, prefixLength);

  // Calculate edit positions
  const startIndex = prefixLength;
  const oldEndIndex = oldContent.length - suffixLength;
  const newEndIndex = newContent.length - suffixLength;

  // Sanity check: ensure indices are valid
  if (startIndex > oldEndIndex || startIndex > newEndIndex) {
    return null;
  }

  // Calculate Point positions
  const startPosition = offsetToPoint(oldContent, startIndex);
  const oldEndPosition = offsetToPoint(oldContent, oldEndIndex);
  const newEndPosition = offsetToPoint(newContent, newEndIndex);

  return {
    startIndex,
    oldEndIndex,
    newEndIndex,
    startPosition,
    oldEndPosition,
    newEndPosition,
  };
}

/**
 * Quick check if an edit is simple (small change that benefits from incremental parsing)
 * Returns false for large changes where full reparse might be faster
 */
export function isSimpleEdit(oldContent: string, newContent: string): boolean {
  const lengthDiff = Math.abs(oldContent.length - newContent.length);

  // If the change is more than 1000 characters, consider it complex
  if (lengthDiff > 1000) {
    return false;
  }

  // Calculate edit to check the actual change size
  const edit = calculateEdit(oldContent, newContent);
  if (!edit) {
    return false;
  }

  // If the changed region is more than 500 bytes, consider it complex
  const oldChangeSize = edit.oldEndIndex - edit.startIndex;
  const newChangeSize = edit.newEndIndex - edit.startIndex;
  const maxChangeSize = Math.max(oldChangeSize, newChangeSize);

  return maxChangeSize <= 500;
}
