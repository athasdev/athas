import type { Position, Range } from "@/features/editor/types/editor";
import { parseSnippet, replaceVariables } from "./snippet-parser";
import type { SnippetSession, TabStop } from "./types";

/**
 * Expand a snippet and create a snippet session
 */
export function expandSnippet(
  snippet: { body: string | string[]; prefix: string },
  insertPosition: Position,
  context?: {
    fileName?: string;
    filePath?: string;
    selectedText?: string;
  },
): SnippetSession {
  // Parse the snippet
  let parsedSnippet = parseSnippet(snippet.body);

  // Replace variables in the expanded body
  parsedSnippet = {
    ...parsedSnippet,
    expandedBody: replaceVariables(parsedSnippet.expandedBody, context),
  };

  // Create snippet session
  const session: SnippetSession = {
    snippetId: `${snippet.prefix}-${Date.now()}`,
    parsedSnippet,
    currentTabStopIndex: 0,
    insertPosition,
    isActive: parsedSnippet.hasTabStops,
  };

  return session;
}

/**
 * Get the current tab stop for a snippet session
 */
export function getCurrentTabStop(session: SnippetSession): TabStop | null {
  if (!session.isActive || session.parsedSnippet.tabStops.length === 0) {
    return null;
  }

  const currentIndex = session.currentTabStopIndex;
  const tabStops = session.parsedSnippet.tabStops;

  // Find the tab stop with the current index
  const tabStop = tabStops.find((ts) => ts.index === currentIndex);

  return tabStop || null;
}

/**
 * Move to the next tab stop in a snippet session
 * Returns the next tab stop, or null if there are no more tab stops
 */
export function nextTabStop(session: SnippetSession): TabStop | null {
  if (!session.isActive) {
    return null;
  }

  const tabStops = session.parsedSnippet.tabStops;
  const uniqueIndices = Array.from(new Set(tabStops.map((ts) => ts.index))).sort((a, b) => a - b);

  const currentIndexPosition = uniqueIndices.indexOf(session.currentTabStopIndex);

  // If we're at the last tab stop or final tab stop (0), end the session
  if (currentIndexPosition === uniqueIndices.length - 1 || session.currentTabStopIndex === 0) {
    session.isActive = false;
    return null;
  }

  // Move to next index
  session.currentTabStopIndex = uniqueIndices[currentIndexPosition + 1];

  return getCurrentTabStop(session);
}

/**
 * Move to the previous tab stop in a snippet session
 * Returns the previous tab stop, or null if at the first tab stop
 */
export function previousTabStop(session: SnippetSession): TabStop | null {
  if (!session.isActive) {
    return null;
  }

  const tabStops = session.parsedSnippet.tabStops;
  const uniqueIndices = Array.from(new Set(tabStops.map((ts) => ts.index))).sort((a, b) => a - b);

  const currentIndexPosition = uniqueIndices.indexOf(session.currentTabStopIndex);

  // If we're at the first tab stop, can't go back
  if (currentIndexPosition <= 0) {
    return null;
  }

  // Move to previous index
  session.currentTabStopIndex = uniqueIndices[currentIndexPosition - 1];

  return getCurrentTabStop(session);
}

/**
 * Get the selection range for a tab stop
 */
export function getTabStopRange(session: SnippetSession, tabStop: TabStop): Range | null {
  const startLine = session.insertPosition.line;
  const startColumn = session.insertPosition.column + tabStop.offset;

  return {
    start: {
      line: startLine,
      column: startColumn,
      offset: session.insertPosition.offset + tabStop.offset,
    },
    end: {
      line: startLine,
      column: startColumn + tabStop.length,
      offset: session.insertPosition.offset + tabStop.offset + tabStop.length,
    },
  };
}

/**
 * Calculate all tab stop positions after snippet insertion
 */
export function getAllTabStopRanges(
  session: SnippetSession,
): Array<{ tabStop: TabStop; range: Range }> {
  return session.parsedSnippet.tabStops.map((tabStop) => ({
    tabStop,
    range: getTabStopRange(session, tabStop)!,
  }));
}
