import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "@/features/file-system/types/app.types";

export interface MentionedFile {
  name: string;
  path: string;
  content: string;
}

export function appendReferencedFiles(message: string, files: MentionedFile[]) {
  if (files.length === 0) return message;

  let processedMessage = `${message}\n\n--- Referenced Files ---\n`;
  for (const file of files) {
    processedMessage += `\n### ${file.name} (${file.path})\n\`\`\`\n${file.content}\n\`\`\`\n`;
  }
  return processedMessage;
}

export async function loadFilesByPaths(filePaths: string[]): Promise<MentionedFile[]> {
  return (
    await Promise.all(
      filePaths.map(async (path) => {
        try {
          const content = await invoke<string>("read_file_custom", { path });
          return {
            name: path.split(/[/\\]/).pop() || path,
            path,
            content,
          } satisfies MentionedFile;
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
