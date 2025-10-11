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
// Handles conversion from byte offsets (from tree-sitter) to character positions
function convertToLineTokens(
  content: string,
  tokens: Array<{ start: number; end: number; class_name: string }>,
): Map<number, LineToken[]> {
  const lines = content.split("\n");
  const tokensByLine = new Map<number, LineToken[]>();

  // Build a byte-to-character mapping for proper UTF-8 handling
  const encoder = new TextEncoder();
  let byteOffset = 0;
  let charOffset = 0;
  const byteToChar = new Map<number, number>();

  for (let i = 0; i < content.length; i++) {
    byteToChar.set(byteOffset, charOffset);
    const char = content[i];
    const charBytes = encoder.encode(char).length;
    byteOffset += charBytes;
    charOffset++;
  }
  byteToChar.set(byteOffset, charOffset); // End position

  // Convert byte offsets to character offsets
  const charTokens = tokens.map((token) => ({
    start: byteToChar.get(token.start) ?? 0,
    end: byteToChar.get(token.end) ?? content.length,
    class_name: token.class_name,
  }));

  let currentCharOffset = 0;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const lineLength = lines[lineNumber].length;
    const lineStart = currentCharOffset;
    const lineEnd = currentCharOffset + lineLength;
    const lineTokens: LineToken[] = [];

    // Find tokens that overlap with this line
    for (const token of charTokens) {
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

    currentCharOffset += lineLength + 1; // +1 for newline
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
