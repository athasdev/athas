import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getSourceEditorBufferByPath } from "@/features/editor/utils/buffer-index";
import { buildSearchRegex } from "@/features/editor/utils/search";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { writeFile } from "@/features/file-system/controllers/platform";
import type { ContentSearchOptions } from "../types/global-search.types";

interface ReplaceTarget {
  filePath: string;
  line: number;
  column: number;
}

interface SourceContent {
  bufferId: string | null;
  content: string;
}

const REPLACE_ALL_CONCURRENCY = 8;

function lineColumnToOffset(content: string, line: number, column: number): number {
  const lines = content.split("\n");
  let offset = 0;

  for (let index = 0; index < Math.max(0, line - 1) && index < lines.length; index++) {
    offset += lines[index].length + 1;
  }

  return offset + Math.max(0, Math.min(column - 1, lines[line - 1]?.length ?? 0));
}

function getSourceContent(filePath: string): SourceContent | null {
  const { buffers } = useBufferStore.getState();
  const openSourceBuffer = getSourceEditorBufferByPath(buffers, filePath);

  if (openSourceBuffer) {
    return { bufferId: openSourceBuffer.id, content: openSourceBuffer.content };
  }

  return null;
}

function getOpenSourceContentByPath(): Map<string, SourceContent> {
  const sourcesByPath = new Map<string, SourceContent>();

  for (const buffer of useBufferStore.getState().buffers) {
    if (buffer.type === "editor" && !buffer.isVirtual) {
      sourcesByPath.set(buffer.path, { bufferId: buffer.id, content: buffer.content });
    }
  }

  return sourcesByPath;
}

async function readSource(
  filePath: string,
  openSourcesByPath?: ReadonlyMap<string, SourceContent>,
): Promise<SourceContent> {
  const openSource = openSourcesByPath?.get(filePath) ?? getSourceContent(filePath);
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
  const openSourcesByPath = getOpenSourceContentByPath();
  let nextFileIndex = 0;
  let totalReplacements = 0;

  const replaceWorker = async () => {
    while (nextFileIndex < filePaths.length) {
      const filePath = filePaths[nextFileIndex];
      nextFileIndex++;
      if (!filePath) continue;

      const source = await readSource(filePath, openSourcesByPath);
      let matchCount = 0;
      const fileRegex = buildSearchRegex(query, options);
      if (!fileRegex) continue;
      const replacementRegex = options.useRegex
        ? new RegExp(fileRegex.source, fileRegex.flags.replace(/g/g, ""))
        : null;
      const nextContent = source.content.replace(fileRegex, (...args) => {
        matchCount++;
        const matchText = args[0] as string;
        return options.useRegex ? matchText.replace(replacementRegex!, replacement) : replacement;
      });

      if (matchCount > 0 && nextContent !== source.content) {
        await writeSource(filePath, source.bufferId, nextContent);
        totalReplacements += matchCount;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(REPLACE_ALL_CONCURRENCY, filePaths.length) }, replaceWorker),
  );

  return totalReplacements;
}
