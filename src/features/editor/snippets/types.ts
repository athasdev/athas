import type { Position } from "@/features/editor/types/editor";

/**
 * Represents a tab stop in a snippet
 * Tab stops allow the user to navigate through placeholders
 */
export interface TabStop {
  index: number; // 0 is the final tab stop
  placeholder?: string;
  choices?: string[]; // For choice tab stops like ${1|choice1,choice2|}
  offset: number; // Character offset in the expanded snippet
  length: number; // Length of the placeholder text
}

/**
 * Represents a parsed snippet ready for expansion
 */
export interface ParsedSnippet {
  body: string; // Original snippet body
  expandedBody: string; // Body with variables replaced, tab stops marked
  tabStops: TabStop[];
  hasTabStops: boolean;
}

/**
 * Represents the current state of an active snippet session
 */
export interface SnippetSession {
  snippetId: string;
  parsedSnippet: ParsedSnippet;
  currentTabStopIndex: number;
  insertPosition: Position;
  isActive: boolean;
}

/**
 * Represents a snippet from an extension
 */
export interface Snippet {
  prefix: string;
  body: string | string[];
  description?: string;
  scope?: string;
  language: string;
}
