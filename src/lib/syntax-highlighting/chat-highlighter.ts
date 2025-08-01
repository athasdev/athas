import { shikiHighlighter } from "./shiki-highlighter";

class ChatHighlighter {
  private highlightCache = new Map<string, string>();
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (!this.isInitialized) {
      await shikiHighlighter.initialize();
      this.isInitialized = true;
    }
  }

  /**
   * Highlight a complete code block
   */
  async highlightCodeBlock(code: string, language: string): Promise<string> {
    await this.initialize();

    const cacheKey = `${language}:${code}`;
    if (this.highlightCache.has(cacheKey)) {
      return this.highlightCache.get(cacheKey)!;
    }

    try {
      const result = await shikiHighlighter.highlightCode(code, language);
      const html = this.tokensToHtml(result.tokens, code);

      // Cache with size limit
      if (this.highlightCache.size > 100) {
        const firstKey = this.highlightCache.keys().next().value;
        if (firstKey) {
          this.highlightCache.delete(firstKey);
        }
      }

      this.highlightCache.set(cacheKey, html);
      return html;
    } catch (error) {
      console.error("Error highlighting code:", error);
      return this.escapeHtml(code);
    }
  }

  /**
   * Convert Shiki tokens to HTML with Athas theme classes
   */
  private tokensToHtml(shikiTokens: any, originalContent: string): string {
    if (!shikiTokens || shikiTokens.length === 0) {
      return this.escapeHtml(originalContent);
    }

    let html = "";

    // Process each line of tokens
    shikiTokens.forEach((line: any) => {
      line.forEach((token: any) => {
        const scope = token.explanation?.[0]?.scopes?.[0] || "text";
        const className = this.mapScopeToClassName(scope);
        html += `<span class="${className}">${this.escapeHtml(token.content)}</span>`;
      });
    });

    return html;
  }

  /**
   * Map TextMate scope to Athas theme class name
   */
  private mapScopeToClassName(scope: string): string {
    const scopeToClass: Record<string, string> = {
      keyword: "token-keyword",
      "keyword.control": "token-keyword",
      "keyword.operator": "token-operator",
      string: "token-string",
      "string.quoted": "token-string",
      "string.template": "token-string",
      comment: "token-comment",
      "comment.line": "token-comment",
      "comment.block": "token-comment",
      constant: "token-constant",
      "constant.numeric": "token-number",
      "constant.language": "token-boolean",
      variable: "token-variable",
      "variable.parameter": "token-variable",
      "entity.name.function": "token-function",
      "entity.name.type": "token-type",
      "entity.name.tag": "token-tag",
      "entity.other.attribute-name": "token-attribute",
      "support.function": "token-function",
      "support.type": "token-type",
      "storage.type": "token-type",
      "storage.modifier": "token-keyword",
      punctuation: "token-punctuation",
      "meta.tag": "token-tag",
      "markup.heading": "token-title",
      "markup.bold": "token-bold",
      "markup.italic": "token-italic",
      "markup.inline.raw": "token-code",
    };

    // Find the best match for the scope
    for (const [scopePattern, className] of Object.entries(scopeToClass)) {
      if (scope.includes(scopePattern)) {
        return className;
      }
    }

    return "token-text";
  }

  /**
   * Escape HTML characters
   */
  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  clearCache(): void {
    this.highlightCache.clear();
  }

  async setTheme(theme: string): Promise<void> {
    await shikiHighlighter.setTheme(theme as any);
    this.clearCache();
  }
}

// Export singleton instance
export const chatHighlighter = new ChatHighlighter();
