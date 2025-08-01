import type { LineToken } from "../../types/editor-types";
import type { Token } from "./shiki-highlighter";

/**
 * Centralized token service for managing syntax highlighting tokens
 * This replaces the old buffer store token caching with a more efficient system
 */
class TokenService {
  private lineTokens: Map<number, Token[]> = new Map();

  /**
   * Update tokens for specific lines
   */
  updateLineTokens(lineTokens: Map<number, Token[]>): void {
    // Clear old tokens and update with new ones
    this.lineTokens.clear();
    lineTokens.forEach((tokens, lineNumber) => {
      this.lineTokens.set(lineNumber, tokens);
    });
  }

  /**
   * Get tokens for a specific line
   */
  getLineTokens(lineNumber: number): Token[] {
    return this.lineTokens.get(lineNumber) || [];
  }

  /**
   * Get all line tokens as a Map
   */
  getAllLineTokens(): Map<number, Token[]> {
    return new Map(this.lineTokens);
  }

  /**
   * Convert Shiki tokens to editor line tokens format
   */
  convertToEditorLineTokens(): Map<number, LineToken[]> {
    const editorTokens = new Map<number, LineToken[]>();

    this.lineTokens.forEach((tokens, lineNumber) => {
      const lineTokens: LineToken[] = tokens.map((token) => ({
        startColumn: token.startColumn,
        endColumn: token.endColumn,
        className: token.class_name,
      }));

      if (lineTokens.length > 0) {
        editorTokens.set(lineNumber, lineTokens);
      }
    });

    return editorTokens;
  }

  /**
   * Clear all tokens
   */
  clear(): void {
    this.lineTokens.clear();
  }

  /**
   * Get the number of lines with tokens
   */
  getLineCount(): number {
    return this.lineTokens.size;
  }
}

// Export singleton instance
export const tokenService = new TokenService();
