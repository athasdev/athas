import { useCallback } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { editorAPI } from "@/features/editor/extensions/api";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { logger } from "../utils/logger";

interface Definition {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface UseGoToDefinitionProps {
  getDefinition?: (
    filePath: string,
    line: number,
    character: number,
  ) => Promise<Definition[] | null>;
  isLanguageSupported?: (filePath: string) => boolean;
  filePath: string;
  fontSize: number;
  lineNumbers: boolean;
  gutterWidth: number;
  charWidth: number;
}

export const useGoToDefinition = ({
  getDefinition,
  isLanguageSupported,
  filePath,
  fontSize,
  lineNumbers,
  gutterWidth,
  charWidth,
}: UseGoToDefinitionProps) => {
  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      // Only handle Cmd+Click (Mac) or Ctrl+Click (Windows/Linux)
      if (!e.metaKey && !e.ctrlKey) {
        return;
      }

      if (!getDefinition || !isLanguageSupported?.(filePath || "")) {
        return;
      }

      e.preventDefault();

      const editor = e.currentTarget;
      if (!editor) return;

      const rect = editor.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const lineHeight = Math.ceil(fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);
      const contentOffsetX = lineNumbers
        ? gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN
        : EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
      const paddingTop = EDITOR_CONSTANTS.EDITOR_PADDING_TOP;

      const line = Math.floor((y - paddingTop + editor.scrollTop) / lineHeight);
      const character = Math.floor((x - contentOffsetX + editor.scrollLeft) / charWidth);

      if (line >= 0 && character >= 0) {
        try {
          logger.info("Editor", `Go to definition at ${filePath}:${line}:${character}`);
          const definitions = await getDefinition(filePath || "", line, character);

          if (definitions && definitions.length > 0) {
            const target = definitions[0];
            const targetFilePath = target.uri.replace("file://", "");

            const bufferStore = useBufferStore.getState();
            const existingBuffer = bufferStore.buffers.find((b) => b.path === targetFilePath);

            if (existingBuffer) {
              bufferStore.actions.setActiveBuffer(existingBuffer.id);
            } else {
              const content = await readFileContent(targetFilePath);
              const fileName = targetFilePath.split("/").pop() || "untitled";
              const bufferId = bufferStore.actions.openBuffer(targetFilePath, fileName, content);
              bufferStore.actions.setActiveBuffer(bufferId);
            }

            // Set cursor position after buffer is ready
            setTimeout(() => {
              const lines = editorAPI.getLines();
              let offset = 0;
              for (let i = 0; i < target.range.start.line; i++) {
                offset += (lines[i]?.length || 0) + 1;
              }
              offset += target.range.start.character;

              editorAPI.setCursorPosition({
                line: target.range.start.line,
                column: target.range.start.character,
                offset,
              });

              logger.info(
                "Editor",
                `Jumped to ${targetFilePath}:${target.range.start.line}:${target.range.start.character}`,
              );
            }, 100);
          } else {
            logger.debug("Editor", "No definition found");
          }
        } catch (error) {
          logger.error("Editor", "Go to definition error:", error);
        }
      }
    },
    [getDefinition, isLanguageSupported, filePath, fontSize, lineNumbers, gutterWidth, charWidth],
  );

  return {
    handleClick,
  };
};
