import { getTokens, type Token as RustToken } from "../rust-api/tokens";
import type { Token } from "./shiki-highlighter";

/**
 * Tree-sitter based syntax highlighter using Rust backend
 * Optimized for large files and static content highlighting
 */
export class TreeSitterHighlighter {
  private static instance: TreeSitterHighlighter | null = null;
  private tokenCache: Map<string, { tokens: Token[]; lineTokens: Map<number, Token[]> }> =
    new Map();
  private isInitialized: boolean = true; // Tree-sitter is always ready

  private constructor() {}

  static getInstance(): TreeSitterHighlighter {
    if (!TreeSitterHighlighter.instance) {
      TreeSitterHighlighter.instance = new TreeSitterHighlighter();
    }
    return TreeSitterHighlighter.instance;
  }

  /**
   * Initialize the highlighter (no-op for Tree-sitter, always ready)
   */
  async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  /**
   * Check if the highlighter is ready
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get file extension from file path
   */
  private getFileExtension(filePath: string): string {
    const parts = filePath.split(".");
    if (parts.length < 2) return "";

    const ext = parts[parts.length - 1].toLowerCase();

    // Handle special cases
    if (ext === "erb" && parts[parts.length - 2] === "html") {
      return "html.erb";
    }

    return ext;
  }

  /**
   * Check if a file extension is supported by Tree-sitter
   */
  isSupportedLanguage(filePath: string): boolean {
    const ext = this.getFileExtension(filePath);
    const supportedExtensions = [
      // Web technologies
      "js",
      "jsx",
      "ts",
      "tsx",
      "json",
      "html",
      "htm",
      "css",

      // Systems languages
      "c",
      "cpp",
      "cxx",
      "cc",
      "c++",
      "rs",
      "go",

      // Object-oriented languages
      "java",
      "swift",
      "m",
      "scala",

      // Dynamic languages
      "py",
      "rb",
      "ruby",
      "lua",
      "php",

      // Functional languages
      "hs",

      // Markup languages
      "xml",

      // Data & config
      "yml",
      "yaml",
      "toml",

      // Shell & scripting
      "sh",
      "bash",

      // Documentation
      "md",
      "markdown",

      // Templates
      "erb",
      "html.erb",
    ];

    return supportedExtensions.includes(ext);
  }

  /**
   * Convert Rust tokens to our Token format
   */
  private convertRustTokensToEditorTokens(
    rustTokens: RustToken[],
    content: string,
  ): { tokens: Token[]; lineTokens: Map<number, Token[]> } {
    const tokens: Token[] = [];
    const lineTokens: Map<number, Token[]> = new Map();
    const lines = content.split("\n");

    // Calculate line starts for offset-to-position conversion
    const lineStarts: number[] = [0];
    let offset = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      offset += lines[i].length + 1; // +1 for newline
      lineStarts.push(offset);
    }

    rustTokens.forEach((rustToken) => {
      // Find which line this token is on
      let line = 0;
      for (let i = lineStarts.length - 1; i >= 0; i--) {
        if (rustToken.start >= lineStarts[i]) {
          line = i;
          break;
        }
      }

      // Calculate column positions
      const lineStart = lineStarts[line];
      const startColumn = rustToken.start - lineStart;
      const endColumn = rustToken.end - lineStart;

      const editorToken: Token = {
        start: rustToken.start,
        end: rustToken.end,
        token_type: rustToken.token_type,
        class_name: rustToken.class_name,
        line,
        startColumn,
        endColumn,
      };

      tokens.push(editorToken);

      // Add to line tokens
      if (!lineTokens.has(line)) {
        lineTokens.set(line, []);
      }
      lineTokens.get(line)!.push(editorToken);
    });

    // Sort tokens within each line by start column
    lineTokens.forEach((lineTokenList) => {
      lineTokenList.sort((a, b) => a.startColumn - b.startColumn);
    });

    return { tokens, lineTokens };
  }

  /**
   * Highlight content using Tree-sitter
   */
  async highlightContent(
    content: string,
    filePath: string,
  ): Promise<{ tokens: Token[]; lineTokens: Map<number, Token[]> }> {
    if (!this.isSupportedLanguage(filePath)) {
      // Return empty tokens for unsupported languages
      return { tokens: [], lineTokens: new Map() };
    }

    // Check cache first
    const cacheKey = `${filePath}:${content.length}:${this.hashContent(content)}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const fileExtension = this.getFileExtension(filePath);
      const rustTokens = await getTokens(content, fileExtension);
      const result = this.convertRustTokensToEditorTokens(rustTokens, content);

      // Cache the result
      this.tokenCache.set(cacheKey, result);

      // Limit cache size
      if (this.tokenCache.size > 50) {
        const firstKey = this.tokenCache.keys().next().value;
        if (firstKey) {
          this.tokenCache.delete(firstKey);
        }
      }

      return result;
    } catch (error) {
      console.error("Tree-sitter highlighting failed:", error);
      // Return empty tokens on error
      return { tokens: [], lineTokens: new Map() };
    }
  }

  /**
   * Highlight specific lines (for incremental updates)
   * Note: Tree-sitter works on full content, so this re-highlights everything
   * but only returns tokens for the requested lines
   */
  async highlightLines(
    content: string,
    filePath: string,
    startLine: number,
    endLine: number,
  ): Promise<Map<number, Token[]>> {
    const { lineTokens } = await this.highlightContent(content, filePath);
    const result = new Map<number, Token[]>();

    for (let line = startLine; line <= endLine; line++) {
      const tokens = lineTokens.get(line);
      if (tokens) {
        result.set(line, tokens);
      }
    }

    return result;
  }

  /**
   * Simple hash function for content caching
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Clear the token cache
   */
  clearCache(): void {
    this.tokenCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.tokenCache.size,
      keys: Array.from(this.tokenCache.keys()),
    };
  }
}

// Export singleton instance
export const treeSitterHighlighter = TreeSitterHighlighter.getInstance();
