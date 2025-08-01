import {
  type BundledLanguage,
  type BundledTheme,
  createHighlighter,
  createJavaScriptRegexEngine,
  type Highlighter,
} from "shiki";
import { CodeToTokenTransformStream } from "shiki-stream";

export interface Token {
  start: number;
  end: number;
  token_type: string;
  class_name: string;
  line: number;
  startColumn: number;
  endColumn: number;
}

export interface LineTokens {
  line: number;
  tokens: Token[];
}

export interface HighlightResult {
  tokens: Token[];
  lineTokens: Map<number, Token[]>;
}

class ShikiHighlighter {
  private highlighter: Highlighter | null = null;
  private initialized = false;
  private currentTheme: BundledTheme = "dark-plus";

  async initialize(theme: BundledTheme = "dark-plus"): Promise<void> {
    if (this.initialized && this.currentTheme === theme) {
      return;
    }

    try {
      // Create highlighter with JavaScript regex engine for better performance
      this.highlighter = await createHighlighter({
        themes: [theme, "light-plus", "github-dark", "github-light"],
        langs: [
          // Web technologies
          "javascript",
          "typescript",
          "jsx",
          "tsx",
          "json",
          "html",
          "css",

          // Systems languages
          "c",
          "cpp",
          "rust",
          "go",
          "zig",

          // Object-oriented languages
          "java",
          "swift",
          "objective-c",
          "scala",

          // Dynamic languages
          "python",
          "ruby",
          "lua",
          "php",

          // Functional languages
          "haskell",

          // Markup languages
          "xml",

          // Data & config
          "yaml",
          "toml",

          // Shell & scripting
          "bash",

          // Documentation
          "markdown",

          // Additional languages for fallback
          "sql",
          "kotlin",
          "dart",
          "vue",
          "svelte",
        ],
        engine: createJavaScriptRegexEngine(),
      });

      this.currentTheme = theme;
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize Shiki highlighter:", error);
      throw error;
    }
  }

  async highlightCode(code: string, language: string): Promise<HighlightResult> {
    if (!this.highlighter) {
      await this.initialize();
    }

    try {
      const lang = this.mapFileExtensionToLanguage(language);
      const tokens = await this.highlighter!.codeToTokens(code, {
        lang: lang as BundledLanguage,
        theme: this.currentTheme,
      });

      return this.convertShikiTokensToEditorTokens(tokens);
    } catch (error) {
      console.error("Syntax highlighting error:", error);
      return { tokens: [], lineTokens: new Map() };
    }
  }

  async highlightLines(
    lines: string[],
    language: string,
    startLine: number = 0,
  ): Promise<Map<number, Token[]>> {
    if (!this.highlighter) {
      await this.initialize();
    }

    const result = new Map<number, Token[]>();
    const lang = this.mapFileExtensionToLanguage(language);

    try {
      for (let i = 0; i < lines.length; i++) {
        const lineNumber = startLine + i;
        const lineContent = lines[i];

        if (lineContent.trim() === "") {
          result.set(lineNumber, []);
          continue;
        }

        const tokens = await this.highlighter!.codeToTokens(lineContent, {
          lang: lang as BundledLanguage,
          theme: this.currentTheme,
        });

        const lineTokens = this.convertShikiTokensToLineTokens(tokens, lineNumber);
        result.set(lineNumber, lineTokens);
      }
    } catch (error) {
      console.error("Line highlighting error:", error);
    }

    return result;
  }

  async highlightIncremental(
    content: string,
    language: string,
    changedLines: Set<number>,
  ): Promise<Map<number, Token[]>> {
    if (!this.highlighter) {
      await this.initialize();
    }

    const lines = content.split("\n");
    const result = new Map<number, Token[]>();
    const lang = this.mapFileExtensionToLanguage(language);

    try {
      // Only highlight changed lines for better performance
      const linesToHighlight = Array.from(changedLines).sort((a, b) => a - b);

      for (const lineNumber of linesToHighlight) {
        if (lineNumber >= 0 && lineNumber < lines.length) {
          const lineContent = lines[lineNumber];

          if (lineContent.trim() === "") {
            result.set(lineNumber, []);
            continue;
          }

          const tokens = await this.highlighter!.codeToTokens(lineContent, {
            lang: lang as BundledLanguage,
            theme: this.currentTheme,
          });

          const lineTokens = this.convertShikiTokensToLineTokens(tokens, lineNumber);
          result.set(lineNumber, lineTokens);
        }
      }
    } catch (error) {
      console.error("Incremental highlighting error:", error);
    }

    return result;
  }

  /**
   * Create a streaming highlighter for real-time code highlighting
   */
  createStreamingHighlighter(language: string, theme?: BundledTheme): CodeToTokenTransformStream {
    if (!this.highlighter) {
      throw new Error("Highlighter not initialized. Call initialize() first.");
    }

    const lang = this.mapFileExtensionToLanguage(language);
    const currentTheme = theme || this.currentTheme;

    return new CodeToTokenTransformStream({
      highlighter: this.highlighter,
      lang: lang as BundledLanguage,
      theme: currentTheme,
      allowRecalls: true, // Allow re-highlighting for better accuracy
    });
  }

  private convertShikiTokensToEditorTokens(shikiTokens: any): HighlightResult {
    const tokens: Token[] = [];
    const lineTokens = new Map<number, Token[]>();

    shikiTokens.forEach((line: any, lineIndex: number) => {
      const lineTokenList: Token[] = [];
      let columnOffset = 0;

      line.forEach((token: any) => {
        const startColumn = columnOffset;
        const endColumn = columnOffset + token.content.length;

        // Use the token's explanation (TextMate scope) for mapping
        const scope = token.explanation?.[0]?.scopes?.[0] || "text";

        const editorToken: Token = {
          start: 0, // Will be calculated based on line position
          end: 0, // Will be calculated based on line position
          token_type: this.mapShikiScopeToTokenType(scope),
          class_name: this.mapShikiScopeToClassName(scope),
          line: lineIndex,
          startColumn,
          endColumn,
        };

        tokens.push(editorToken);
        lineTokenList.push(editorToken);
        columnOffset = endColumn;
      });

      lineTokens.set(lineIndex, lineTokenList);
    });

    return { tokens, lineTokens };
  }

  private convertShikiTokensToLineTokens(shikiTokens: any, lineNumber: number): Token[] {
    const tokens: Token[] = [];
    let columnOffset = 0;

    if (shikiTokens.length > 0 && shikiTokens[0]) {
      shikiTokens[0].forEach((token: any) => {
        const startColumn = columnOffset;
        const endColumn = columnOffset + token.content.length;

        // Use the token's explanation (TextMate scope) for mapping
        const scope = token.explanation?.[0]?.scopes?.[0] || "text";

        tokens.push({
          start: 0,
          end: 0,
          token_type: this.mapShikiScopeToTokenType(scope),
          class_name: this.mapShikiScopeToClassName(scope),
          line: lineNumber,
          startColumn,
          endColumn,
        });

        columnOffset = endColumn;
      });
    }

    return tokens;
  }

  private mapFileExtensionToLanguage(extension: string): string {
    const mapping: Record<string, string> = {
      // Web technologies
      js: "javascript",
      jsx: "jsx",
      ts: "typescript",
      tsx: "tsx",
      json: "json",
      html: "html",
      htm: "html",
      css: "css",

      // Systems languages
      c: "c",
      cpp: "cpp",
      cxx: "cpp",
      cc: "cpp",
      "c++": "cpp",
      rs: "rust",
      go: "go",
      zig: "zig",

      // Object-oriented languages
      java: "java",
      swift: "swift",
      m: "objective-c",
      scala: "scala",

      // Dynamic languages
      py: "python",
      rb: "ruby",
      ruby: "ruby",
      lua: "lua",
      php: "php",

      // Functional languages
      hs: "haskell",

      // Markup languages
      xml: "xml",

      // Data & config
      yml: "yaml",
      yaml: "yaml",
      toml: "toml",

      // Shell & scripting
      sh: "bash",
      bash: "bash",

      // Documentation
      md: "markdown",
      markdown: "markdown",

      // Templates
      erb: "text", // ERB doesn't have direct Shiki support, fallback to text
      "html.erb": "text",

      // Additional languages for fallback
      sql: "sql",
      kt: "kotlin",
      dart: "dart",
      vue: "vue",
      svelte: "svelte",
    };

    return mapping[extension.toLowerCase()] || "text";
  }

  private mapShikiScopeToTokenType(scope: string): string {
    // Map Shiki TextMate scopes to Tree-sitter compatible token types
    const scopeToType: Record<string, string> = {
      // Keywords - matches Tree-sitter "keyword"
      keyword: "keyword",
      "keyword.control": "keyword",
      "keyword.operator": "keyword",
      "keyword.function": "keyword",
      "keyword.return": "keyword",
      "storage.modifier": "keyword",
      "storage.type": "keyword",

      // Strings - matches Tree-sitter "string"
      string: "string",
      "string.quoted": "string",
      "string.template": "string",
      "string.escape": "string",
      "string.special": "string",

      // Numbers - matches Tree-sitter "number"
      "constant.numeric": "number",
      "constant.numeric.integer": "number",
      "constant.numeric.float": "number",

      // Constants - matches Tree-sitter "constant"
      constant: "constant",
      "constant.builtin": "constant",
      "constant.language": "constant",

      // Comments - matches Tree-sitter "comment"
      comment: "comment",
      "comment.line": "comment",
      "comment.block": "comment",

      // Functions - matches Tree-sitter "function"
      "entity.name.function": "function",
      "support.function": "function",
      "meta.function-call": "function",

      // Types - matches Tree-sitter "type"
      "entity.name.type": "type",
      "support.type": "type",
      "entity.name.class": "type",

      // Variables/Identifiers - matches Tree-sitter "identifier"
      variable: "identifier",
      "variable.parameter": "identifier",
      "variable.other": "identifier",
      "meta.definition.variable": "identifier",

      // Properties - matches Tree-sitter "property"
      "variable.object.property": "property",
      "meta.object-literal.key": "property",
      "entity.name.tag.yaml": "property",

      // Operators - matches Tree-sitter "operator"
      "keyword.operator.arithmetic": "operator",
      "keyword.operator.assignment": "operator",
      "keyword.operator.comparison": "operator",
      "keyword.operator.logical": "operator",

      // Punctuation - matches Tree-sitter "punctuation"
      punctuation: "punctuation",
      "punctuation.bracket": "punctuation",
      "punctuation.delimiter": "punctuation",
      "punctuation.special": "punctuation",

      // JSX/Tags - matches Tree-sitter "jsx"
      "entity.name.tag": "jsx",
      "meta.tag": "jsx",
      "support.class.component": "jsx",

      // JSX Attributes - matches Tree-sitter "jsx-attribute"
      "entity.other.attribute-name": "jsx-attribute",
      "meta.attribute": "jsx-attribute",

      // Markdown specific
      "markup.heading": "title",
      "markup.bold": "bold",
      "markup.italic": "italic",
      "markup.inline.raw": "code",
    };

    // Find the best match for the scope (most specific first)
    const sortedScopes = Object.keys(scopeToType).sort((a, b) => b.length - a.length);

    for (const scopePattern of sortedScopes) {
      if (scope.includes(scopePattern)) {
        return scopeToType[scopePattern];
      }
    }

    return "text";
  }

  private mapShikiScopeToClassName(scope: string): string {
    const tokenType = this.mapShikiScopeToTokenType(scope);
    return `token-${tokenType}`;
  }

  async setTheme(theme: BundledTheme): Promise<void> {
    if (this.currentTheme !== theme) {
      this.currentTheme = theme;
      // Reinitialize with new theme
      this.initialized = false;
      await this.initialize(theme);
    }
  }

  dispose(): void {
    this.highlighter = null;
    this.initialized = false;
  }
}

// Export singleton instance
export const shikiHighlighter = new ShikiHighlighter();
