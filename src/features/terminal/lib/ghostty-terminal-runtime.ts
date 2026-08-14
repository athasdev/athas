import type { ISearchOptions } from "@xterm/addon-search";
import type { ITerminalOptions } from "ghostty-web";
import type {
  TerminalDisposable,
  TerminalFrontend,
  TerminalRuntimeAddons,
} from "../types/terminal-frontend.types";

interface SearchMatch {
  column: number;
  length: number;
  row: number;
}

interface SearchResults {
  resultIndex: number;
  resultCount: number;
}

let ghosttyInitialization: Promise<void> | null = null;

export async function createGhosttyTerminalRuntime(
  options: ITerminalOptions,
): Promise<{ terminal: TerminalFrontend; addons: TerminalRuntimeAddons }> {
  const ghosttyWeb = await import("ghostty-web");
  ghosttyInitialization ??= ghosttyWeb.init();
  await ghosttyInitialization;

  const terminal = new ghosttyWeb.Terminal(options);
  const fitAddon = new ghosttyWeb.FitAddon();
  const searchAddon = new GhosttySearchAddon(terminal);

  terminal.loadAddon(fitAddon);

  return {
    terminal,
    addons: {
      fitAddon,
      searchAddon,
      serializeAddon: {
        serialize: () => serializeTerminalBuffer(terminal),
      },
    },
  };
}

class GhosttySearchAddon {
  private listeners = new Set<(results: SearchResults) => void>();
  private matches: SearchMatch[] = [];
  private resultIndex = -1;
  private searchKey = "";

  constructor(private terminal: TerminalFrontend) {}

  onDidChangeResults(listener: (results: SearchResults) => void): TerminalDisposable {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  findNext(term: string, options: ISearchOptions = {}): boolean {
    const searchKey = getSearchKey(term, options);
    if (searchKey !== this.searchKey || options.incremental) {
      this.updateMatches(term, options);
      this.resultIndex = this.matches.length > 0 ? 0 : -1;
    } else if (this.matches.length > 0) {
      this.resultIndex = (this.resultIndex + 1) % this.matches.length;
    }

    return this.selectCurrentMatch();
  }

  findPrevious(term: string, options: ISearchOptions = {}): boolean {
    const searchKey = getSearchKey(term, options);
    if (searchKey !== this.searchKey) {
      this.updateMatches(term, options);
      this.resultIndex = this.matches.length - 1;
    } else if (this.matches.length > 0) {
      this.resultIndex = (this.resultIndex - 1 + this.matches.length) % this.matches.length;
    }

    return this.selectCurrentMatch();
  }

  clearDecorations(): void {
    this.searchKey = "";
    this.matches = [];
    this.resultIndex = -1;
    this.terminal.clearSelection();
    this.emitResults();
  }

  private updateMatches(term: string, options: ISearchOptions): void {
    this.searchKey = getSearchKey(term, options);
    this.matches = findGhosttyTerminalMatches(this.terminal, term, options);
  }

  private selectCurrentMatch(): boolean {
    const match = this.matches[this.resultIndex];
    if (!match) {
      this.terminal.clearSelection();
      this.emitResults();
      return false;
    }

    this.terminal.select(match.column, match.row, match.length);
    this.emitResults();
    return true;
  }

  private emitResults(): void {
    const results = {
      resultIndex: this.resultIndex,
      resultCount: this.matches.length,
    };
    for (const listener of this.listeners) listener(results);
  }
}

export function findGhosttyTerminalMatches(
  terminal: Pick<TerminalFrontend, "buffer">,
  term: string,
  options: ISearchOptions,
): SearchMatch[] {
  if (!term) return [];

  const expression = createSearchExpression(term, options);
  if (!expression) return [];

  const matches: SearchMatch[] = [];
  const buffer = terminal.buffer.active;
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row)?.translateToString(true) ?? "";
    expression.lastIndex = 0;

    for (let match = expression.exec(line); match; match = expression.exec(line)) {
      matches.push({ column: match.index, length: match[0].length, row });
      if (match[0].length === 0) expression.lastIndex++;
    }
  }

  return matches;
}

function createSearchExpression(term: string, options: ISearchOptions): RegExp | null {
  const source = options.regex ? term : escapeRegularExpression(term);
  const boundedSource = options.wholeWord ? `\\b(?:${source})\\b` : source;

  try {
    return new RegExp(boundedSource, options.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

function getSearchKey(term: string, options: ISearchOptions): string {
  return JSON.stringify([term, options.caseSensitive, options.wholeWord, options.regex]);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function serializeTerminalBuffer(terminal: Pick<TerminalFrontend, "buffer">): string {
  const lines: string[] = [];
  const buffer = terminal.buffer.active;
  for (let row = 0; row < buffer.length; row++) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
  }

  while (lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
