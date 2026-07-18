import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "@/features/file-system/types/app.types";

export interface MentionedFile {
  name: string;
  path: string;
  content: string;
}

export async function parseMentionsAndLoadFiles(
  message: string,
  allProjectFiles: FileEntry[],
): Promise<{ processedMessage: string; mentionedFiles: MentionedFile[] }> {
  const mentionRegex = /@(\S+)/g;
  const mentions = [...message.matchAll(mentionRegex)];
  const mentionedFiles = (
    await Promise.all(
      mentions.map(async (match) => {
        const fileName = match[1];
        const file = allProjectFiles.find((f) => !f.isDir && f.name === fileName);

        if (!file) return null;

        try {
          const content = await invoke<string>("read_file_custom", { path: file.path });
          return {
            name: file.name,
            path: file.path,
            content,
          } satisfies MentionedFile;
        } catch (error) {
          console.error(`Error reading file ${file.path}:`, error);
          return null;
        }
      }),
    )
  ).filter((file): file is MentionedFile => file !== null);

  // Create a processed message with file contents appended
  let processedMessage = message;

  if (mentionedFiles.length > 0) {
    processedMessage += "\n\n--- Referenced Files ---\n";
    for (const file of mentionedFiles) {
      processedMessage += `\n### ${file.name} (${file.path})\n\`\`\`\n${file.content}\n\`\`\`\n`;
    }
  }

  return { processedMessage, mentionedFiles };
}
