import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "../../types/app";

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
  const mentionedFiles: MentionedFile[] = [];

  // Load content for each mentioned file
  for (const match of mentions) {
    const fileName = match[1];
    const file = allProjectFiles.find(f => !f.isDir && f.name === fileName);

    if (file) {
      try {
        const content = await invoke<string>("read_file_custom", { path: file.path });
        mentionedFiles.push({
          name: file.name,
          path: file.path,
          content,
        });
      } catch (error) {
        console.error(`Error reading file ${file.path}:`, error);
      }
    }
  }

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
