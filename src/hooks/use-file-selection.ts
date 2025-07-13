import type React from "react";
import { useCallback } from "react";
import type { CodeEditorRef } from "../components/editor/code-editor";
import type { VimMode } from "../types/app";
import { getFilenameFromPath, isImageFile, isSQLiteFile } from "../utils/file-utils";
import type { GitDiff, GitDiffLine } from "../utils/git";
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

// Parse raw diff content into GitDiff format
const parseRawDiffContent = (content: string, filePath: string): GitDiff => {
  const lines = content.split("\n");
  const diffLines: GitDiffLine[] = [];
  let currentOldLine = 1;
  let currentNewLine = 1;
  let fileName = getFilenameFromPath(filePath);

  // Remove .diff or .patch extension for display
  fileName = fileName.replace(/\.(diff|patch)$/i, "");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Hunk header: @@ -old_start,old_count +new_start,new_count @@
    if (line.startsWith("@@")) {
      const hunkMatch = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@(.*)?/);
      if (hunkMatch) {
        currentOldLine = parseInt(hunkMatch[1]);
        currentNewLine = parseInt(hunkMatch[2]);

        diffLines.push({
          line_type: "header",
          content: line,
          old_line_number: undefined,
          new_line_number: undefined,
        });
      }
      continue;
    }

    // File headers (ignore for now)
    if (
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("diff ") ||
      line.startsWith("index ")
    ) {
      continue;
    }

    // Added line
    if (line.startsWith("+")) {
      diffLines.push({
        line_type: "added",
        content: line.substring(1), // Remove the + prefix
        old_line_number: undefined,
        new_line_number: currentNewLine,
      });
      currentNewLine++;
    }
    // Removed line
    else if (line.startsWith("-")) {
      diffLines.push({
        line_type: "removed",
        content: line.substring(1), // Remove the - prefix
        old_line_number: currentOldLine,
        new_line_number: undefined,
      });
      currentOldLine++;
    }
    // Context line (unchanged)
    else if (line.startsWith(" ")) {
      diffLines.push({
        line_type: "context",
        content: line.substring(1), // Remove the space prefix
        old_line_number: currentOldLine,
        new_line_number: currentNewLine,
      });
      currentOldLine++;
      currentNewLine++;
    }
    // Empty line or other content
    else if (line.trim()) {
      diffLines.push({
        line_type: "context",
        content: line,
        old_line_number: currentOldLine,
        new_line_number: currentNewLine,
      });
      currentOldLine++;
      currentNewLine++;
    }
  }

  return {
    file_path: fileName,
    old_path: undefined,
    new_path: undefined,
    is_new: false,
    is_deleted: false,
    is_renamed: false,
    is_binary: false,
    is_image: false,
    old_blob_base64: undefined,
    new_blob_base64: undefined,
    lines: diffLines,
  };
};

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

          // Check if this is a diff/patch file by extension or content
          const isDiffFile = /\.(diff|patch)$/i.test(path) || safeContent.includes("@@");

          if (isDiffFile && safeContent.includes("@@")) {
            // Parse raw diff content into GitDiff format
            const parsedDiff = parseRawDiffContent(safeContent, path);
            const diffJson = JSON.stringify(parsedDiff);
            openBuffer(path, fileName, diffJson, false, false, true, false);
          } else {
            openBuffer(path, fileName, safeContent, false, false, false, false);
          }

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
                if (
                  "setSelectionRange" in textarea &&
                  typeof textarea.setSelectionRange === "function"
                ) {
                  (textarea as unknown as HTMLTextAreaElement).setSelectionRange(
                    targetPosition,
                    targetPosition,
                  );
                }

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
