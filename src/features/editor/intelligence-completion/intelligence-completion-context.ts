import type {
  AutocompleteDiagnostic,
  AutocompleteRecentEdit,
  AutocompleteRelatedFile,
} from "@/features/ai/intelligence/services/intelligence-text-service";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";

const MAX_RECENT_EDITS = 5;
const MAX_SNIPPET_CHARS = 400;
const SNIPPET_CONTEXT_LINES = 1;
const MAX_DIAGNOSTICS = 5;
const DIAGNOSTIC_LINE_WINDOW = 20;
const MAX_DIAGNOSTIC_MESSAGE_CHARS = 300;

const SEVERITY_RANK: Record<Diagnostic["severity"], number> = {
  error: 3,
  warning: 2,
  info: 1,
};

export const SENSITIVE_FILE_PATTERN =
  /(?:^|[/\\])(?:\.env(?:\..*)?|[^/\\]+\.(?:pem|key|p12|pfx))$/i;

interface RecentEditEntry extends AutocompleteRecentEdit {
  line: number;
}

/** The lines of a document, one-based, as the edit tracker reads them. */
export interface RecentEditDocument {
  lineCount: number;
  lineText(lineNumber: number): string;
}

const recentEdits: RecentEditEntry[] = [];

/**
 * Records the lines around an edit as a short snippet for completion context. `startLine` is the
 * one-based line where the edit starts and `insertedText` is the text it inserted.
 */
export function recordRecentEdit(
  filePath: string,
  document: RecentEditDocument,
  startLine: number,
  insertedText: string,
) {
  if (!filePath || SENSITIVE_FILE_PATTERN.test(filePath)) return;

  const insertedLines = insertedText.split(/\r?\n/).length - 1;
  const firstLine = Math.max(1, startLine - SNIPPET_CONTEXT_LINES);
  const lastLine = Math.min(document.lineCount, startLine + insertedLines + SNIPPET_CONTEXT_LINES);
  const lines: string[] = [];
  for (let line = firstLine; line <= lastLine; line += 1) lines.push(document.lineText(line));
  const snippet = lines.join("\n").slice(0, MAX_SNIPPET_CHARS);
  if (!snippet.trim()) return;

  const last = recentEdits[recentEdits.length - 1];
  if (last && last.filePath === filePath && Math.abs(last.line - startLine) <= 2) {
    recentEdits.pop();
  }
  recentEdits.push({ filePath, snippet, line: startLine });
  if (recentEdits.length > MAX_RECENT_EDITS) recentEdits.shift();
}

/**
 * Recent edits other than the one at the cursor, oldest first. The edit being typed right
 * now is already in the prefix, so sending it again only costs tokens.
 */
export function getRecentEdits(filePath: string, line: number): AutocompleteRecentEdit[] {
  return recentEdits
    .filter((edit) => edit.filePath !== filePath || Math.abs(edit.line - line) > 2)
    .map(({ filePath: path, snippet }) => ({ filePath: path, snippet }));
}

export function clearRecentEdits() {
  recentEdits.length = 0;
}

/** Errors and warnings near a one-based line, closest and most severe first. */
export function getNearbyDiagnostics(
  diagnostics: readonly Pick<Diagnostic, "severity" | "message" | "line">[],
  line: number,
): AutocompleteDiagnostic[] {
  return diagnostics
    .map((diagnostic) => ({ ...diagnostic, line: diagnostic.line + 1 }))
    .filter(
      (diagnostic) =>
        SEVERITY_RANK[diagnostic.severity] >= SEVERITY_RANK.warning &&
        Math.abs(diagnostic.line - line) <= DIAGNOSTIC_LINE_WINDOW,
    )
    .sort(
      (a, b) =>
        Math.abs(a.line - line) - Math.abs(b.line - line) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    )
    .slice(0, MAX_DIAGNOSTICS)
    .map((diagnostic) => ({
      line: diagnostic.line,
      severity: diagnostic.severity,
      message: diagnostic.message.slice(0, MAX_DIAGNOSTIC_MESSAGE_CHARS),
    }));
}

const MAX_RELATED_FILES = 3;
const MAX_RELATED_SNIPPET_CHARS = 1200;
const MAX_RELATED_LINE_CHARS = 160;
const RELATED_FALLBACK_LINES = 30;

/** An open file that may give the model useful context, such as a module the file imports. */
export interface RelatedFileCandidate {
  path: string;
  content: string;
  languageId?: string | null;
}

const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s+|\bimport\s+|\brequire\(\s*|\bimport\(\s*)["']([^"']+)["']/g;
const PYTHON_IMPORT_PATTERN = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
const DECLARATION_PATTERN =
  /^\s*(?:export\s|pub(?:\([^)]*\))?\s|(?:async\s+)?function\s|class\s|interface\s|type\s+\w|enum\s|def\s|fn\s|struct\s|impl\b|trait\s|func\s|module\s|public\s|protected\s|abstract\s)/;

function fileStem(path: string) {
  const name = path.split(/[/\\]/).pop() ?? "";
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

/** The last path segment each import refers to, in the order they appear. */
function importedStems(text: string): string[] {
  const stems: string[] = [];
  const add = (specifier: string, separator: RegExp) => {
    const segments = specifier.split(separator).filter((segment) => segment && segment !== ".");
    const last = segments
      .pop()
      ?.replace(/\.[^.]+$/, "")
      .toLowerCase();
    if (!last || last === "..") return;
    // `./components` usually means `./components/index`.
    stems.push(last === "index" ? (segments.pop()?.toLowerCase() ?? last) : last);
  };
  for (const match of text.matchAll(IMPORT_SPECIFIER_PATTERN)) add(match[1]!, /\//);
  for (const match of text.matchAll(PYTHON_IMPORT_PATTERN)) add(match[1] ?? match[2]!, /\./);
  return [...new Set(stems)];
}

/** A file's declarations (exports, functions, types), or its opening lines when it has none. */
export function summarizeRelatedFile(content: string): string {
  const lines = content.split(/\r?\n/);
  const declarations = lines.filter((line) => DECLARATION_PATTERN.test(line));
  const picked = declarations.length > 0 ? declarations : lines.slice(0, RELATED_FALLBACK_LINES);
  let snippet = "";
  for (const line of picked) {
    const trimmed = line.trimEnd().slice(0, MAX_RELATED_LINE_CHARS);
    if (!trimmed.trim()) continue;
    if (snippet.length + trimmed.length + 1 > MAX_RELATED_SNIPPET_CHARS) break;
    snippet += `${trimmed}\n`;
  }
  return snippet.trimEnd();
}

/**
 * Short summaries of other open files for completion context: first the ones the text before the
 * cursor imports, then other open files in the same language. Sensitive files are never sent.
 */
export function getRelatedFileSnippets(
  filePath: string,
  languageId: string | null | undefined,
  textBeforeCursor: string,
  candidates: readonly RelatedFileCandidate[],
): AutocompleteRelatedFile[] {
  const usable = candidates.filter(
    (candidate) =>
      candidate.path &&
      candidate.path !== filePath &&
      candidate.content.trim() &&
      !SENSITIVE_FILE_PATTERN.test(candidate.path),
  );
  const stems = importedStems(textBeforeCursor);
  const imported = stems.flatMap((stem) =>
    usable.filter((candidate) => {
      if (fileStem(candidate.path) === stem) return true;
      const parts = candidate.path.split(/[/\\]/);
      return (
        fileStem(candidate.path) === "index" && parts[parts.length - 2]?.toLowerCase() === stem
      );
    }),
  );
  const sameLanguage = languageId
    ? usable.filter((candidate) => candidate.languageId === languageId).reverse()
    : [];

  const related: AutocompleteRelatedFile[] = [];
  const seen = new Set<string>();
  for (const candidate of [...imported, ...sameLanguage]) {
    if (related.length >= MAX_RELATED_FILES) break;
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    const snippet = summarizeRelatedFile(candidate.content);
    if (snippet) related.push({ filePath: candidate.path, snippet });
  }
  return related;
}
