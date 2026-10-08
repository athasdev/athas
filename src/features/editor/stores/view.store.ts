import { create } from "zustand";
import { isEditorContent } from "@/features/panes/types/pane-content.types";
import { createSelectors } from "@/utils/zustand-selectors";
import { readBufferText } from "../services/buffer-text";
import { useBufferStore } from "./buffer.store";

interface EditorViewState {
  actions: {
    getLines: () => string[];
    getLineCount: () => number;
    getContent: () => string;
  };
}

/**
 * The active buffer's lines, split when someone asks for them and kept until the text changes.
 * This used to be rebuilt from the whole document on every keystroke, which cost tens of
 * milliseconds per key in large files while nothing rendered from it.
 */
let cachedLines: { content: string; lines: string[] } | null = null;

function getActiveContent(): string {
  const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
  return activeBuffer && isEditorContent(activeBuffer) ? readBufferText(activeBuffer) : "";
}

function getLinesOf(content: string): string[] {
  if (cachedLines?.content === content) return cachedLines.lines;
  const lines = content.split("\n");
  cachedLines = { content, lines };
  return lines;
}

function countLines(content: string): number {
  if (cachedLines?.content === content) return cachedLines.lines.length;
  let count = 1;
  for (let index = content.indexOf("\n"); index !== -1; index = content.indexOf("\n", index + 1)) {
    count++;
  }
  return count;
}

export const useEditorViewStore = createSelectors(
  create<EditorViewState>()(() => ({
    actions: {
      getLines: () => getLinesOf(getActiveContent()),
      getLineCount: () => countLines(getActiveContent()),
      getContent: getActiveContent,
    },
  })),
);
