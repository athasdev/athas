import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { DEFAULT_ATTACHMENT_BUDGET, truncateTextToTokens } from "@/features/ai/lib/context-budget";

export interface MentionedFile {
  name: string;
  path: string;
  content: string;
  /** Set when the content was cut to fit the attachment budget. */
  truncated?: boolean;
  /** The estimated size of the whole file, before any truncation. */
  originalTokens?: number;
}

function codeFence(content: string) {
  const longestRun = Math.max(2, ...(content.match(/`{3,}/g) ?? []).map((run) => run.length));
  return "`".repeat(longestRun + 1);
}

export function appendReferencedFiles(message: string, files: MentionedFile[]) {
  if (files.length === 0) return message;

  let processedMessage = `${message}\n\n--- Referenced Files ---\n`;
  for (const file of files) {
    const fence = codeFence(file.content);
    const note = file.truncated
      ? ` [truncated to fit the context budget; read the file for the rest]`
      : "";
    processedMessage += `\n### ${file.name} (${file.path})${note}\n${fence}\n${file.content}\n${fence}\n`;
  }
  return processedMessage;
}

export async function loadFilesByPaths(
  filePaths: string[],
  maxTokensPerFile: number = DEFAULT_ATTACHMENT_BUDGET.perAttachmentTokens,
): Promise<MentionedFile[]> {
  return (
    await Promise.all(
      filePaths.map(async (path): Promise<MentionedFile | null> => {
        try {
          const raw = await invoke<string>("read_file_custom", { path });
          const { text, truncated, originalTokens } = truncateTextToTokens(raw, maxTokensPerFile);
          return {
            name: path.split(/[/\\]/).pop() || path,
            path,
            content: text,
            truncated,
            originalTokens,
          };
        } catch (error) {
          console.error(`Error reading file ${path}:`, error);
          return null;
        }
      }),
    )
  ).filter((file): file is MentionedFile => file !== null);
}

export interface MentionToken {
  /** Offset of the leading `@` in the message. */
  start: number;
  /** Offset just past the token. */
  end: number;
  name: string;
  /** The exact file path the chip pointed at; absent for chips saved before paths were kept. */
  path?: string;
}

/**
 * `@[name](path)` as the composer writes a file chip. The name escapes `\` and `]` with a
 * backslash; the path percent-encodes `%`, parentheses and whitespace so the token stays one
 * piece. Chats saved earlier hold `@[name]` without a path.
 */
const MENTION_TOKEN_PATTERN = /@\[((?:\\.|[^\\\]\n])+)\](?:\(([^()\s]+)\))?/g;

function encodeMentionPath(path: string) {
  return path.replace(/[%()\s]/g, (character) =>
    character === "(" ? "%28" : character === ")" ? "%29" : encodeURIComponent(character),
  );
}

function decodeMentionPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function formatMentionToken(name: string, path?: string): string {
  const label = name.replace(/[\\\]]/g, "\\$&");
  return path ? `@[${label}](${encodeMentionPath(path)})` : `@[${label}]`;
}

/** Only structured chip tokens count; `@types/node`, decorators and emails are plain text. */
export function parseMentionTokens(message: string): MentionToken[] {
  return [...message.matchAll(MENTION_TOKEN_PATTERN)].map((match) => {
    const start = match.index ?? 0;
    return {
      start,
      end: start + match[0].length,
      name: match[1].replace(/\\(.)/g, "$1"),
      ...(match[2] ? { path: decodeMentionPath(match[2]) } : {}),
    };
  });
}

export function extractFileMentionNames(message: string): string[] {
  return parseMentionTokens(message).map((token) => token.name);
}

function normalizeMentionPath(path: string) {
  return path.replace(/\\/g, "/");
}

/**
 * The files a message mentions. Tokens with a path resolve to exactly that path. A saved
 * `@[name]` token resolves when one project file has that relative path or that name; an
 * ambiguous name is left unresolved rather than guessed.
 */
export function resolveMentionPaths(message: string, allProjectFiles: FileEntry[]): string[] {
  const files = allProjectFiles.filter((file) => !file.isDir);
  const paths = new Set<string>();
  for (const token of parseMentionTokens(message)) {
    if (token.path) {
      paths.add(token.path);
      continue;
    }
    const name = normalizeMentionPath(token.name);
    const byRelativePath = files.filter((file) =>
      normalizeMentionPath(file.path).endsWith(`/${name}`),
    );
    const candidates = name.includes("/")
      ? byRelativePath
      : files.filter((file) => file.name === token.name);
    if (candidates.length === 1) paths.add(candidates[0].path);
  }
  return Array.from(paths);
}

export async function parseMentionsAndLoadFiles(
  message: string,
  allProjectFiles: FileEntry[],
): Promise<{ processedMessage: string; mentionedFiles: MentionedFile[] }> {
  const mentionedFiles = await loadFilesByPaths(resolveMentionPaths(message, allProjectFiles));

  return { processedMessage: appendReferencedFiles(message, mentionedFiles), mentionedFiles };
}
