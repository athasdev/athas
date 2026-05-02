import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { buildSearchRegex } from "@/features/editor/utils/search";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { writeFile } from "@/features/file-system/controllers/platform";
import type { ContentSearchOptions } from "../hooks/use-content-search";

interface ReplaceTarget {
  filePath: string;
  line: number;
  column: number;
}

function lineColumnToOffset(content: string, line: number, column: number): number {
  const lines = content.split("\n");
  let offset = 0;

  for (let index = 0; index < Math.max(0, line - 1) && index < lines.length; index++) {
    offset += lines[index].length + 1;
  }

  return offset + Math.max(0, Math.min(column - 1, lines[line - 1]?.length ?? 0));
}

function getSourceContent(filePath: string): { bufferId: string | null; content: string } | null {
  const { buffers } = useBufferStore.getState();
  const openSourceBuffer = buffers.find(
    (buffer) => buffer.type === "editor" && !buffer.isVirtual && buffer.path === filePath,
  );

  if (openSourceBuffer?.type === "editor") {
    return { bufferId: openSourceBuffer.id, content: openSourceBuffer.content };
  }

  return null;
}

async function readSource(filePath: string): Promise<{ bufferId: string | null; content: string }> {
  const openSource = getSourceContent(filePath);
  if (openSource) return openSource;

  return {
    bufferId: null,
    content: await readFileContent(filePath),
  };
}

async function writeSource(filePath: string, bufferId: string | null, content: string) {
  if (bufferId) {
    useBufferStore.getState().actions.updateBufferContent(bufferId, content, true);
  } else {
    await writeFile(filePath, content);
  }
}

function replacementText(
  match: RegExpExecArray,
  regex: RegExp,
  replacement: string,
  useRegex: boolean,
): string {
  if (!useRegex) return replacement;

  const flags = regex.flags.replace(/g/g, "");
  return match[0].replace(new RegExp(regex.source, flags), replacement);
}

export async function replaceNextInSource(
  target: ReplaceTarget,
  query: string,
  replacement: string,
  options: ContentSearchOptions,
): Promise<boolean> {
  const regex = buildSearchRegex(query, options);
  if (!regex) return false;

  const source = await readSource(target.filePath);
  const targetOffset = lineColumnToOffset(source.content, target.line, target.column);
  let selectedMatch: RegExpExecArray | null = null;
  let match = regex.exec(source.content);

  while (match) {
    const matchEnd = match.index + match[0].length;
    if (match.index >= targetOffset || (targetOffset >= match.index && targetOffset <= matchEnd)) {
      selectedMatch = match;
      break;
    }
    if (match.index === regex.lastIndex) regex.lastIndex++;
    match = regex.exec(source.content);
  }

  if (!selectedMatch) return false;

  const nextContent =
    source.content.slice(0, selectedMatch.index) +
    replacementText(selectedMatch, regex, replacement, options.useRegex) +
    source.content.slice(selectedMatch.index + selectedMatch[0].length);

  await writeSource(target.filePath, source.bufferId, nextContent);
  return true;
}

export async function replaceAllInSources(
  filePaths: string[],
  query: string,
  replacement: string,
  options: ContentSearchOptions,
): Promise<number> {
  const regex = buildSearchRegex(query, options);
  if (!regex) return 0;

  let replacedCount = 0;

  for (const filePath of filePaths) {
    const source = await readSource(filePath);
    let matchCount = 0;
    regex.lastIndex = 0;
    const nextContent = source.content.replace(regex, (...args) => {
      matchCount++;
      const matchText = args[0] as string;
      return options.useRegex
        ? matchText.replace(new RegExp(regex.source, regex.flags.replace(/g/g, "")), replacement)
        : replacement;
    });

    if (matchCount > 0 && nextContent !== source.content) {
      await writeSource(filePath, source.bufferId, nextContent);
      replacedCount += matchCount;
    }
  }

  return replacedCount;
}
