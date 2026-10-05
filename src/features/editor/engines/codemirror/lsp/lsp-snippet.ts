/** Resolves an LSP snippet variable such as `TM_FILENAME`; undefined for unknown variables. */
export type SnippetVariableResolver = (name: string) => string | undefined;

type Mode = "template" | "plain";

/** Escapes text so CodeMirror's snippet parser inserts it literally. */
function escapeTemplateText(text: string) {
  return text.replace(/[{}]/g, (brace) => `\\${brace}`);
}

class LspSnippetParser {
  private index = 0;

  constructor(
    private readonly source: string,
    private readonly resolveVariable: SnippetVariableResolver,
  ) {}

  parse(mode: Mode, untilBrace: boolean): string {
    let output = "";
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === "\\") {
        const next = this.source[this.index + 1];
        if (next === "$" || next === "}" || next === "\\") {
          output += this.text(next, mode);
          this.index += 2;
          continue;
        }
        output += this.text(char, mode);
        this.index += 1;
        continue;
      }
      if (char === "}" && untilBrace) return output;
      if (char === "$") {
        const element = this.parseDollar(mode);
        if (element !== null) {
          output += element;
          continue;
        }
      }
      output += this.text(char, mode);
      this.index += 1;
    }
    return output;
  }

  private text(value: string, mode: Mode) {
    return mode === "template" ? escapeTemplateText(value) : value;
  }

  private tabStop(tabStop: number, defaultText: string, mode: Mode) {
    if (mode === "plain") return defaultText;
    // CodeMirror placeholders hold one line without braces; anything else is inserted as text
    // in front of a bare tab stop.
    if (!defaultText) return `\${${tabStop}}`;
    if (/[{}\n\r]/.test(defaultText)) return `${escapeTemplateText(defaultText)}\${${tabStop}}`;
    return `\${${tabStop}:${defaultText}}`;
  }

  private variable(name: string, defaultText: string | null, mode: Mode) {
    const value = this.resolveVariable(name);
    if (value !== undefined) return this.text(value, mode);
    if (defaultText !== null) return this.text(defaultText, mode);
    if (mode === "plain") return name;
    return `\${${name}}`;
  }

  /** Parses the element starting at a `$`, or returns null when it is a literal dollar sign. */
  private parseDollar(mode: Mode): string | null {
    const rest = this.source.slice(this.index + 1);
    const bareTabStop = /^\d+/.exec(rest);
    if (bareTabStop) {
      this.index += 1 + bareTabStop[0].length;
      return this.tabStop(Number(bareTabStop[0]), "", mode);
    }
    const bareVariable = /^[_a-zA-Z][_a-zA-Z0-9]*/.exec(rest);
    if (bareVariable) {
      this.index += 1 + bareVariable[0].length;
      return this.variable(bareVariable[0], null, mode);
    }
    if (rest[0] !== "{") return null;

    const start = this.index;
    const head = /^\{(\d+|[_a-zA-Z][_a-zA-Z0-9]*)/.exec(rest);
    if (!head) return null;
    const name = head[1];
    const isTabStop = /^\d/.test(name);
    this.index += 1 + head[0].length;
    const next = this.source[this.index];

    if (next === "}") {
      this.index += 1;
      return isTabStop ? this.tabStop(Number(name), "", mode) : this.variable(name, null, mode);
    }
    if (next === ":") {
      this.index += 1;
      const defaultText = this.parse("plain", true);
      if (this.source[this.index] !== "}") return this.restore(start);
      this.index += 1;
      return isTabStop
        ? this.tabStop(Number(name), defaultText, mode)
        : this.variable(name, defaultText, mode);
    }
    if (next === "|" && isTabStop) {
      const choice = /^\|((?:\\.|[^|\\])*)\|\}/.exec(this.source.slice(this.index));
      if (!choice) return this.restore(start);
      this.index += choice[0].length;
      const first = choice[1].split(/(?<!\\),/)[0] ?? "";
      return this.tabStop(Number(name), first.replace(/\\(.)/g, "$1"), mode);
    }
    if (next === "/" && !isTabStop) {
      // A variable transform; the variable's value is used without the transform.
      const transform = /^\/(?:\\.|[^/\\])*\/(?:\\.|[^/\\])*\/[a-z]*\}/.exec(
        this.source.slice(this.index),
      );
      if (!transform) return this.restore(start);
      this.index += transform[0].length;
      return this.variable(name, "", mode);
    }
    return this.restore(start);
  }

  private restore(start: number): null {
    this.index = start;
    return null;
  }
}

/**
 * Converts an LSP snippet (`$1`, `${1:default}`, `${1|a,b|}`, `$0`, variables) to CodeMirror's
 * snippet template syntax, where every field is `${n}` or `${n:default}` and literal braces are
 * escaped.
 */
export function lspSnippetToCodeMirror(
  snippet: string,
  resolveVariable: SnippetVariableResolver = () => undefined,
): string {
  return new LspSnippetParser(snippet, resolveVariable).parse("template", false);
}

/** The text an LSP snippet inserts with every field left at its default. */
export function lspSnippetToPlainText(
  snippet: string,
  resolveVariable: SnippetVariableResolver = () => undefined,
): string {
  return new LspSnippetParser(snippet, resolveVariable).parse("plain", false);
}
