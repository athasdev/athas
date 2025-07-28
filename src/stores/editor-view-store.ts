import isEqual from "fast-deep-equal";
import { createWithEqualityFn } from "zustand/traditional";
import { createSelectors } from "@/utils/zustand-selectors";
import type { LineToken } from "../types/editor-types";
import { useBufferStore } from "./buffer-store";

interface EditorViewState {
  // Computed views of the active buffer
  lines: string[];
  lineTokens: Map<number, LineToken[]>;

  // Actions
  actions: {
    getLines: () => string[];
    getLineTokens: () => Map<number, LineToken[]>;
    getContent: () => string;
  };
}

// Helper function to convert buffer tokens to line tokens
function convertToLineTokens(
  content: string,
  tokens: Array<{ start: number; end: number; class_name: string }>,
): Map<number, LineToken[]> {
  const lines = content.split("\n");
  const tokensByLine = new Map<number, LineToken[]>();

  let currentOffset = 0;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const lineLength = lines[lineNumber].length;
    const lineStart = currentOffset;
    const lineEnd = currentOffset + lineLength;
    const lineTokens: LineToken[] = [];

    // Find tokens that overlap with this line
    for (const token of tokens) {
      if (token.start >= lineEnd) break;
      if (token.end <= lineStart) continue;

      const tokenStartInLine = Math.max(0, token.start - lineStart);
      const tokenEndInLine = Math.min(lineLength, token.end - lineStart);

      if (tokenStartInLine < tokenEndInLine) {
        lineTokens.push({
          startColumn: tokenStartInLine,
          endColumn: tokenEndInLine,
          className: token.class_name,
        });
      }
    }

    if (lineTokens.length > 0) {
      tokensByLine.set(lineNumber, lineTokens);
    }

    currentOffset += lineLength + 1; // +1 for newline
  }

  return tokensByLine;
}

export const useEditorViewStore = createSelectors(
  createWithEqualityFn<EditorViewState>()(
    (_set, _get) => ({
      // These will be computed from the active buffer
      lines: [""],
      lineTokens: new Map(),

      actions: {
        getLines: () => {
          const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
          if (!activeBuffer) return [""];
          return activeBuffer.content.split("\n");
        },

        getLineTokens: () => {
          const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
          if (!activeBuffer) return new Map();
          return convertToLineTokens(activeBuffer.content, activeBuffer.tokens);
        },

        getContent: () => {
          const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
          return activeBuffer?.content || "";
        },
      },
    }),
    isEqual,
  ),
);

// Subscribe to buffer changes and update computed values
useBufferStore.subscribe((state) => {
  const activeBuffer = state.actions.getActiveBuffer();
  if (activeBuffer) {
    useEditorViewStore.setState({
      lines: activeBuffer.content.split("\n"),
      lineTokens: convertToLineTokens(activeBuffer.content, activeBuffer.tokens),
    });
  } else {
    useEditorViewStore.setState({
      lines: [""],
      lineTokens: new Map(),
    });
  }
});
