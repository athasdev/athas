import React, { useCallback } from "react";
import { CodeEditorRef } from "../components/code-editor";
import { VimMode } from "../types/app";
import { getFilenameFromPath, isImageFile, isSQLiteFile } from "../utils/file-utils";
import { readFile } from "../utils/platform";

interface UseFileSelectionProps {
  openBuffer: (
    path: string,
    name: string,
    content: string,
    isSQLite: boolean,
    isImage: boolean,
    isDiff: boolean,
    isVirtual: boolean,
  ) => void;
  handleFolderToggle: (path: string) => Promise<void>;
  vimEnabled: boolean;
  setVimMode: (mode: VimMode) => void;
  updateCursorPosition: () => void;
  codeEditorRef: React.RefObject<CodeEditorRef | null>;
}

export const useFileSelection = ({
  openBuffer,
  handleFolderToggle,
  vimEnabled,
  setVimMode,
  updateCursorPosition,
  codeEditorRef,
}: UseFileSelectionProps) => {
  const handleFileSelect = useCallback(
    async (path: string, isDir: boolean, line?: number, column?: number) => {
      if (isDir) {
        handleFolderToggle(path);
        return;
      }

      const fileName = getFilenameFromPath(path);

      // Handle virtual diff files
      if (path.startsWith("diff://")) {
        const diffContent = localStorage.getItem(`diff-content-${path}`);
        if (diffContent) {
          openBuffer(path, fileName, diffContent, false, false, true, true); // Mark as diff and virtual
          return;
        } else {
          openBuffer(path, fileName, "No diff content available", false, false, true, true);
          return;
        }
      }

      if (isSQLiteFile(path)) {
        openBuffer(path, fileName, "", true, false, false, false);
      } else if (isImageFile(path)) {
        openBuffer(path, fileName, "", false, true, false, false);
      } else {
        try {
          const content = await readFile(path);

          // Ensure content is not empty/undefined
          const safeContent = content || "";
          openBuffer(path, fileName, safeContent, false, false, false, false);

          // Navigate to specific line/column if provided
          if (line && column) {
            // Use requestAnimationFrame for immediate but smooth execution
            requestAnimationFrame(() => {
              if (codeEditorRef.current?.textarea) {
                const textarea = codeEditorRef.current.textarea;
                const lines = content.split("\n");
                let targetPosition = 0;

                // Calculate position based on line and column
                for (let i = 0; i < line - 1 && i < lines.length; i++) {
                  targetPosition += lines[i].length + 1; // +1 for newline
                }
                if (column) {
                  targetPosition += Math.min(column - 1, lines[line - 1]?.length || 0);
                }

                textarea.focus();
                textarea.setSelectionRange(targetPosition, targetPosition);

                // Scroll to the line
                const lineHeight = 20; // Approximate line height
                const scrollTop = Math.max(0, (line - 1) * lineHeight - textarea.clientHeight / 2);
                textarea.scrollTop = scrollTop;
              }
            });
          }

          // Reset vim mode when opening new file
          if (vimEnabled) {
            setVimMode("normal");
            // Update cursor position immediately after vim mode change
            requestAnimationFrame(() => {
              updateCursorPosition();
            });
          }
        } catch (error) {
          console.error("Error reading file:", error);
          openBuffer(path, fileName, `Error reading file: ${error}`, false, false, false, false);
        }
      }
    },
    [openBuffer, handleFolderToggle, vimEnabled, setVimMode, updateCursorPosition, codeEditorRef],
  );

  return {
    handleFileSelect,
  };
};
