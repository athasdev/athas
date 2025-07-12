import type React from "react";
import { useCallback } from "react";
import { useCodeEditorStore } from "../store/code-editor-store";
import { isMac } from "../utils/platform";

export const useEditorKeyboard = (
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  onChange: (value: string) => void,
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void,
) => {
  // Store subscriptions
  const isLspCompletionVisible = useCodeEditorStore(state => state.isLspCompletionVisible);
  const lspCompletions = useCodeEditorStore(state => state.lspCompletions);
  const selectedLspIndex = useCodeEditorStore(state => state.selectedLspIndex);
  const disabled = useCodeEditorStore(state => state.disabled);
  const tabSize = useCodeEditorStore(state => state.tabSize);
  const language = useCodeEditorStore(state => state.language);
  const vimEnabled = useCodeEditorStore(state => state.vimEnabled);
  const value = useCodeEditorStore(state => state.value);

  // Store actions
  const nextLspCompletion = useCodeEditorStore(state => state.nextLspCompletion);
  const prevLspCompletion = useCodeEditorStore(state => state.prevLspCompletion);
  const setIsLspCompletionVisible = useCodeEditorStore(state => state.setIsLspCompletionVisible);

  // Apply LSP completion (this should be passed from parent for now)
  const applyLspCompletion = useCallback(
    (completion: any) => {
      if (!textareaRef.current) return;
      const textarea = textareaRef.current;
      const cursorPos = textarea.selectionStart;
      const before = value.substring(0, cursorPos);
      const after = value.substring(cursorPos);
      const wordMatch = before.match(/\w*$/);
      const wordStart = wordMatch ? cursorPos - wordMatch[0].length : cursorPos;
      const insertText = completion.insertText || completion.label;
      const newValue = value.substring(0, wordStart) + insertText + after;
      onChange(newValue);
      const newCursorPos = wordStart + insertText.length;
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          textareaRef.current.focus();
        }
      });
      setIsLspCompletionVisible(false);
    },
    [value, onChange, textareaRef, setIsLspCompletionVisible],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return;

      const textarea = e.currentTarget;
      const currentValue = textarea.value;
      const { selectionStart, selectionEnd } = textarea;

      // Handle LSP completion navigation
      if (isLspCompletionVisible && lspCompletions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          nextLspCompletion();
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          prevLspCompletion();
          return;
        }

        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const selectedCompletion = lspCompletions[selectedLspIndex];
          if (selectedCompletion) {
            applyLspCompletion(selectedCompletion);
          }
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          setIsLspCompletionVisible(false);
          return;
        }
      }

      // Handle regular editor shortcuts
      if (!vimEnabled) {
        const cmdKey = isMac() ? e.metaKey : e.ctrlKey;

        // Tab handling
        if (e.key === "Tab") {
          e.preventDefault();
          const spaces = " ".repeat(tabSize);
          const newValue =
            currentValue.substring(0, selectionStart) +
            spaces +
            currentValue.substring(selectionEnd);
          onChange(newValue);
          requestAnimationFrame(() => {
            if (textarea) {
              const newPos = selectionStart + spaces.length;
              textarea.setSelectionRange(newPos, newPos);
            }
          });
          return;
        }

        // Auto-indent on Enter
        if (e.key === "Enter") {
          e.preventDefault();
          const lines = currentValue.substring(0, selectionStart).split("\n");
          const currentLine = lines[lines.length - 1];
          const indentMatch = currentLine.match(/^(\s*)/);
          const currentIndent = indentMatch ? indentMatch[1] : "";

          // Add extra indent for opening braces/brackets
          const shouldIndent = /[{[(]\s*$/.test(currentLine.trim());
          const additionalIndent = shouldIndent ? " ".repeat(tabSize) : "";

          const newValue =
            currentValue.substring(0, selectionStart) +
            "\n" +
            currentIndent +
            additionalIndent +
            currentValue.substring(selectionEnd);
          onChange(newValue);

          requestAnimationFrame(() => {
            if (textarea) {
              const newPos = selectionStart + 1 + currentIndent.length + additionalIndent.length;
              textarea.setSelectionRange(newPos, newPos);
            }
          });
          return;
        }

        // Comment/uncomment toggle
        if (cmdKey && e.key === "/") {
          e.preventDefault();
          const lines = currentValue.split("\n");
          const startLine = currentValue.substring(0, selectionStart).split("\n").length - 1;
          const endLine = currentValue.substring(0, selectionEnd).split("\n").length - 1;

          const commentPrefixes: { [key: string]: string } = {
            javascript: "//",
            typescript: "//",
            python: "#",
            ruby: "#",
            bash: "#",
            css: "/* ",
            html: "<!-- ",
            rust: "//",
            java: "//",
            csharp: "//",
          };

          const commentPrefix = commentPrefixes[language] || "//";
          const commentPattern = new RegExp(
            `^(\\s*)(${commentPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s?)(.*)$`,
          );

          // Check if all selected lines are commented
          const selectedLines = lines.slice(startLine, endLine + 1);
          const allCommented = selectedLines.every(
            line => line.trim() === "" || commentPattern.test(line),
          );

          // Toggle comments
          for (let i = startLine; i <= endLine; i++) {
            if (lines[i].trim() === "") continue;

            if (allCommented) {
              lines[i] = lines[i].replace(commentPattern, "$1$3");
            } else {
              const leadingWhitespace = lines[i].match(/^\s*/)?.[0] || "";
              lines[i] =
                `${leadingWhitespace}${commentPrefix} ${lines[i].substring(leadingWhitespace.length)}`;
            }
          }

          const newValue = lines.join("\n");
          onChange(newValue);
          return;
        }

        // New line below (Cmd/Ctrl + Enter)
        if (cmdKey && e.key === "Enter") {
          e.preventDefault();
          const lines = currentValue.split("\n");
          const currentLine = currentValue.substring(0, selectionStart).split("\n").length - 1;
          const currentLineEnd =
            currentValue.substring(0, selectionStart).lastIndexOf("\n") +
            1 +
            lines[currentLine].length;

          const newValue = `${currentValue.substring(0, currentLineEnd)}\n${currentValue.substring(currentLineEnd)}`;
          onChange(newValue);

          requestAnimationFrame(() => {
            if (textarea) {
              const newPos = currentLineEnd + 1;
              textarea.setSelectionRange(newPos, newPos);
            }
          });
          return;
        }

        // New line above (Cmd/Ctrl + Shift + Enter)
        if (cmdKey && e.shiftKey && e.key === "Enter") {
          e.preventDefault();
          const currentLineStart = currentValue.substring(0, selectionStart).lastIndexOf("\n") + 1;

          const newValue = `${currentValue.substring(0, currentLineStart)}\n${currentValue.substring(currentLineStart)}`;
          onChange(newValue);

          requestAnimationFrame(() => {
            if (textarea) {
              textarea.setSelectionRange(currentLineStart, currentLineStart);
            }
          });
          return;
        }
      }

      // Handle vim mode if enabled
      if (vimEnabled && onKeyDown) {
        onKeyDown(e);
      }
    },
    [
      disabled,
      isLspCompletionVisible,
      lspCompletions,
      selectedLspIndex,
      nextLspCompletion,
      prevLspCompletion,
      applyLspCompletion,
      setIsLspCompletionVisible,
      vimEnabled,
      tabSize,
      language,
      onChange,
      onKeyDown,
    ],
  );

  return {
    handleKeyDown,
  };
};
