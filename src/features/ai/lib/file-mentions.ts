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

export function extractFileMentionNames(message: string): string[] {
  const mentionRegex = /@\[([^\]]+)\]|@(\S+)/g;
  return [...message.matchAll(mentionRegex)]
    .map((match) => match[1] ?? match[2])
    .filter((fileName): fileName is string => Boolean(fileName));
}

export async function parseMentionsAndLoadFiles(
  message: string,
  allProjectFiles: FileEntry[],
): Promise<{ processedMessage: string; mentionedFiles: MentionedFile[] }> {
  const mentionNames = extractFileMentionNames(message);
  const mentionedPaths = new Set(
    mentionNames
      .map(
        (fileName) => allProjectFiles.find((file) => !file.isDir && file.name === fileName)?.path,
      )
      .filter((path): path is string => Boolean(path)),
  );
  const mentionedFiles = await loadFilesByPaths(Array.from(mentionedPaths));

  return { processedMessage: appendReferencedFiles(message, mentionedFiles), mentionedFiles };
}
