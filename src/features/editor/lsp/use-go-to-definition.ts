import { useCallback } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { editorAPI } from "@/features/editor/extensions/api";
import { useCenterCursor } from "@/features/editor/hooks/use-center-cursor";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useJumpListStore } from "@/features/editor/stores/jump-list.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { getBufferByPath } from "@/features/editor/utils/buffer-index";
import { calculateOffsetFromContentPosition } from "@/features/editor/utils/position";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { logger } from "../utils/logger";
import type { EditorCoordinateResolver } from "../view-model/view-layout";
import { getFileReferenceAtPosition } from "./file-reference-navigation";

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
  content: string;
  rootFolderPath?: string;
  lineHeight: number;
  charWidth: number;
  resolveEditorPosition?: EditorCoordinateResolver;
}

export const useGoToDefinition = ({
  getDefinition,
  isLanguageSupported,
  filePath,
  content,
  rootFolderPath,
  lineHeight,
  charWidth,
  resolveEditorPosition,
}: UseGoToDefinitionProps) => {
  const { centerCursorInViewport } = useCenterCursor();

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      // Only handle Cmd+Click (Mac) or Ctrl+Click (Windows/Linux)
      if (!e.metaKey && !e.ctrlKey) {
        return;
      }

      const editor = e.currentTarget;
      if (!editor) return;

      const rect = editor.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Get scroll from textarea (the actual scrollable element)
      const textarea = editor.querySelector("textarea");
      const scrollTop = textarea?.scrollTop ?? 0;
      const scrollLeft = textarea?.scrollLeft ?? 0;

      // Keep the fallback coordinate path aligned with editor content padding.
      const contentOffsetX = EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
      const paddingTop = EDITOR_CONSTANTS.EDITOR_PADDING_TOP;

      const resolvedPosition = resolveEditorPosition?.(e.clientX, e.clientY);
      const line = resolvedPosition?.line ?? Math.floor((y - paddingTop + scrollTop) / lineHeight);
      const character =
        resolvedPosition?.column ?? Math.floor((x - contentOffsetX + scrollLeft) / charWidth);

      if (line >= 0 && character >= 0) {
        const fileReference = getFileReferenceAtPosition({
          content,
          sourceFilePath: filePath,
          rootFolderPath,
          line,
          column: character,
        });

        if (fileReference) {
          e.preventDefault();
          let didOpenFileReference = false;

          try {
            const bufferStore = useBufferStore.getState();
            const existingBuffer = getBufferByPath(bufferStore.buffers, fileReference.targetPath);
            const targetContent = existingBuffer
              ? null
              : await readFileContent(fileReference.targetPath);

            const activeBufferId = bufferStore.activeBufferId;
            if (activeBufferId && filePath) {
              const editorState = useEditorStateStore.getState();
              useJumpListStore.getState().actions.pushEntry({
                bufferId: activeBufferId,
                filePath,
                line: editorState.cursorPosition.line,
                column: editorState.cursorPosition.column,
                offset: editorState.cursorPosition.offset,
                scrollTop: editorState.scrollTop,
                scrollLeft: editorState.scrollLeft,
              });
            }

            if (existingBuffer) {
              bufferStore.actions.setActiveBuffer(existingBuffer.id);
            } else {
              const fileName = fileReference.targetPath.split("/").pop() || "untitled";
              const bufferId = bufferStore.actions.openBuffer(
                fileReference.targetPath,
                fileName,
                targetContent ?? "",
              );
              bufferStore.actions.setActiveBuffer(bufferId);
            }

            setTimeout(() => {
              editorAPI.setCursorPosition({ line: 0, column: 0, offset: 0 });
              requestAnimationFrame(() => {
                centerCursorInViewport(0);
              });
            }, 100);
            didOpenFileReference = true;
          } catch (error) {
            logger.debug(
              "Editor",
              `File reference target not found: ${fileReference.targetPath}`,
              error,
            );
          }

          if (didOpenFileReference) return;
        }

        if (!getDefinition || !isLanguageSupported?.(filePath || "")) {
          return;
        }

        e.preventDefault();

        try {
          logger.info("Editor", `Go to definition at ${filePath}:${line}:${character}`);
          const definitions = await getDefinition(filePath || "", line, character);

          if (definitions && definitions.length > 0) {
            const target = definitions[0];
            const targetFilePath = target.uri.replace("file://", "");

            const bufferStore = useBufferStore.getState();

            // Push current position to jump list before navigating
            const activeBufferId = bufferStore.activeBufferId;
            if (activeBufferId && filePath) {
              const editorState = useEditorStateStore.getState();
              useJumpListStore.getState().actions.pushEntry({
                bufferId: activeBufferId,
                filePath,
                line: editorState.cursorPosition.line,
                column: editorState.cursorPosition.column,
                offset: editorState.cursorPosition.offset,
                scrollTop: editorState.scrollTop,
                scrollLeft: editorState.scrollLeft,
              });
            }
            const existingBuffer = getBufferByPath(bufferStore.buffers, targetFilePath);

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
              const offset = calculateOffsetFromContentPosition(
                editorAPI.getContent(),
                target.range.start.line,
                target.range.start.character,
              );

              editorAPI.setCursorPosition({
                line: target.range.start.line,
                column: target.range.start.character,
                offset,
              });

              requestAnimationFrame(() => {
                centerCursorInViewport(target.range.start.line);
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
    [
      getDefinition,
      isLanguageSupported,
      filePath,
      content,
      rootFolderPath,
      lineHeight,
      charWidth,
      centerCursorInViewport,
      resolveEditorPosition,
    ],
  );

  return {
    handleClick,
  };
};
