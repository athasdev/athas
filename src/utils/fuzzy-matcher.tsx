import { invoke } from "@tauri-apps/api/core";
import type React from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";

export interface FuzzyMatchItem {
  text: string;
  score: number;
  indices: number[];
}

export interface FuzzyMatchRequest {
  pattern: string;
  items: string[];
  case_sensitive?: boolean;
  normalize?: boolean;
}

export interface CompletionFilterRequest {
  pattern: string;
  completions: CompletionItem[];
  context_word: string;
  context_type?: string;
}

export interface FilteredCompletion {
  item: CompletionItem;
  score: number;
  indices: number[];
}

/**
 * Perform fuzzy matching on a list of strings
 */
export async function fuzzyMatch(request: FuzzyMatchRequest): Promise<FuzzyMatchItem[]> {
  return invoke<FuzzyMatchItem[]>("fuzzy_match", { request });
}

/**
 * Filter and sort LSP completions based on fuzzy matching
 */
export async function filterCompletions(
  request: CompletionFilterRequest,
): Promise<FilteredCompletion[]> {
  return invoke<FilteredCompletion[]>("filter_completions", { request });
}

/**
 * Extract the current word being typed at the cursor position
 */
export function extractCurrentWord(text: string, cursorPos: number): string {
  // Find word boundaries before cursor
  let start = cursorPos;
  while (start > 0 && /\w/.test(text[start - 1])) {
    start--;
  }

  // Find word boundaries after cursor (in case cursor is in middle of word)
  let end = cursorPos;
  while (end < text.length && /\w/.test(text[end])) {
    end++;
  }

  return text.substring(start, end);
}

/**
 * Extract the prefix (partial word) before the cursor
 */
export function extractPrefix(text: string, cursorPos: number): string {
  // Find word boundaries before cursor
  let start = cursorPos;
  while (start > 0 && /\w/.test(text[start - 1])) {
    start--;
  }

  return text.substring(start, cursorPos);
}

/**
 * Detect the completion context at the cursor position
 */
export type CompletionContext = "member" | "import" | "type" | "general";

export function detectCompletionContext(text: string, cursorPos: number): CompletionContext {
  // Get the line containing the cursor
  const lines = text.substring(0, cursorPos).split("\n");
  const currentLine = lines[lines.length - 1];

  // Check for member access (after dot)
  if (/\.\s*\w*$/.test(currentLine)) {
    return "member";
  }

  // Check for import statements
  if (/^\s*(import|from|require)\s+/.test(currentLine)) {
    return "import";
  }

  // Check for type annotations (TypeScript)
  if (/:\s*\w*$/.test(currentLine) || /\bas\s+\w*$/.test(currentLine)) {
    return "type";
  }

  return "general";
}

/**
 * Highlight matched characters in a string based on indices
 */
export function highlightMatches(text: string, indices: number[]): React.ReactNode[] {
  if (!indices || indices.length === 0) {
    return [text];
  }

  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  const sortedIndices = [...indices].sort((a, b) => a - b);

  for (const index of sortedIndices) {
    if (index > lastIndex) {
      // Add non-matched text
      result.push(text.substring(lastIndex, index));
    }
    // Add matched character with highlight
    result.push(
      <span key={index} className="font-bold text-blue-400">
        {text[index]}
      </span>,
    );
    lastIndex = index + 1;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.substring(lastIndex));
  }

  return result;
}
