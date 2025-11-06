import isEqual from "fast-deep-equal";
import { createWithEqualityFn } from "zustand/traditional";
import { createSelectors } from "@/utils/zustand-selectors";
import type { LineToken } from "../types/editor";
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

// Helper function to convert buffer tokens to per-line tokens. The incoming
// token offsets are character-based, so we only need to map them onto the
// correct line ranges.
function convertToLineTokens(
  lines: string[],
  tokens: Array<{ start: number; end: number; class_name: string }>,
): Map<number, LineToken[]> {
  const tokensByLine = new Map<number, LineToken[]>();

  if (tokens.length === 0 || lines.length === 0) {
    return tokensByLine;
  }

  // Precompute the starting character offset for each line so we can place
  // tokens without repeatedly scanning the entire content.
  const lineStartOffsets: number[] = new Array(lines.length);
  let runningOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStartOffsets[i] = runningOffset;
    runningOffset += lines[i].length;
    if (i < lines.length - 1) {
      runningOffset += 1; // Account for the newline character between lines
    }
  }

  let lineIndex = 0;
  const lastLineIndex = lines.length - 1;

  for (const token of tokens) {
    const { start, end, class_name } = token;
    if (end <= start) continue;

    // Advance the line pointer until the token start falls within the current
    // line's range. Tokens arrive in order, so we never need to move backwards.
    while (lineIndex + 1 < lines.length && start >= lineStartOffsets[lineIndex + 1]) {
      lineIndex++;
    }

    let currentLine = lineIndex;

    while (currentLine < lines.length) {
      const lineStart = lineStartOffsets[currentLine];
      const lineLength = lines[currentLine].length;
      const lineEnd = lineStart + lineLength;

      const startInLine = Math.max(0, start - lineStart);
      const endInLine = Math.min(lineLength, end - lineStart);

      if (startInLine < endInLine) {
        let lineTokens = tokensByLine.get(currentLine);
        if (!lineTokens) {
          lineTokens = [];
          tokensByLine.set(currentLine, lineTokens);
        }
        lineTokens.push({
          startColumn: startInLine,
          endColumn: endInLine,
          className: class_name,
        });
      }

      if (end <= lineEnd || currentLine === lastLineIndex) {
        break;
      }

      currentLine++;
    }

    lineIndex = currentLine;
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
          return convertToLineTokens(activeBuffer.content.split("\n"), activeBuffer.tokens);
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
{
  let lastBufferId: string | null = null;
  let lastContent: string | null = null;
  let lastTokensRef: Array<{ start: number; end: number; class_name: string }> | null = null;
  let cachedLines: string[] = [""];

  useBufferStore.subscribe((state) => {
    const activeBuffer = state.actions.getActiveBuffer();

    if (!activeBuffer) {
      lastBufferId = null;
      lastContent = null;
      lastTokensRef = null;
      cachedLines = [""];
      useEditorViewStore.setState({
        lines: cachedLines,
        lineTokens: new Map(),
      });
      return;
    }

    const contentChanged = activeBuffer.content !== lastContent;
    const tokensChanged = activeBuffer.tokens !== lastTokensRef;
    const bufferSwitched = activeBuffer.id !== lastBufferId;

    if (!contentChanged && !tokensChanged && !bufferSwitched) {
      return;
    }

    if (contentChanged || bufferSwitched) {
      cachedLines = activeBuffer.content.split("\n");
      lastContent = activeBuffer.content;
    }

    const lineTokens = convertToLineTokens(cachedLines, activeBuffer.tokens);

    useEditorViewStore.setState({
      lines: cachedLines,
      lineTokens,
    });

    lastBufferId = activeBuffer.id;
    lastTokensRef = activeBuffer.tokens;
  });
}
