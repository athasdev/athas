import type React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";
import { useCodeHighlighting } from "../hooks/use-code-highlighting";
import { useEditorKeyboard } from "../hooks/use-editor-keyboard";
import { useEditorScroll } from "../hooks/use-editor-scroll";
import { useCodeEditorStore } from "../store/code-editor-store";
import { cancelCompletion, requestCompletion } from "../utils/ai-completion";
import { cn } from "../utils/cn";
import { CompletionDropdown } from "./completion-dropdown";
import InlineCompletion from "./inline-completion";
import MinimapPane from "./minimap-pane";

// Import language definitions
import "prismjs/components/prism-bash";
import "prismjs/components/prism-css";
import "prismjs/components/prism-java";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-csharp";

// Import minimal theme CSS
import "prismjs/themes/prism.css";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCursorPositionChange?: (position: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  filename?: string;
  vimEnabled?: boolean;
  vimMode?: "normal" | "insert" | "visual";
  cursorPosition?: number;
  searchQuery?: string;
  searchMatches?: { start: number; end: number }[];
  currentMatchIndex?: number;
  filePath?: string;
  fontSize?: number;
  tabSize?: number;
  wordWrap?: boolean;
  lineNumbers?: boolean;
  aiCompletion?: boolean;
  minimap?: boolean;
  // LSP functions passed from parent
  getCompletions?: (filePath: string, line: number, character: number) => Promise<CompletionItem[]>;
  getHover?: (filePath: string, line: number, character: number) => Promise<any>;
  isLanguageSupported?: (filePath: string) => boolean;
  openDocument?: (filePath: string, content: string) => Promise<void>;
  changeDocument?: (filePath: string, content: string) => Promise<void>;
  closeDocument?: (filePath: string) => Promise<void>;
}

export interface CodeEditorRef {
  textarea: HTMLTextAreaElement | null;
}

// Vim Cursor Component
interface VimCursorProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  cursorPosition: number;
  visible: boolean;
}

const VimCursor = ({ textareaRef, cursorPosition, visible }: VimCursorProps) => {
  const fontSize = useCodeEditorStore(state => state.fontSize);

  const cursorStyle = useMemo(() => {
    if (!textareaRef.current || !visible) {
      return { display: "none" };
    }

    const textarea = textareaRef.current;
    const text = textarea.value;
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lines = textBeforeCursor.split("\n");
    const currentLineIndex = lines.length - 1;
    const currentLineText = lines[currentLineIndex];

    const lineHeight = fontSize * 1.4;
    const charWidth = fontSize * 0.6; // Approximate character width
    const top = currentLineIndex * lineHeight + 16;
    const left = currentLineText.length * charWidth + 8;

    return {
      position: "absolute" as const,
      top: `${top}px`,
      left: `${left}px`,
      width: "8px",
      height: `${lineHeight}px`,
      backgroundColor: "var(--text-color)",
      opacity: 0.8,
      pointerEvents: "none" as const,
      zIndex: 10,
      animation: "vim-cursor-blink 1s infinite",
    };
  }, [textareaRef, cursorPosition, visible, fontSize]);

  return <div style={cursorStyle} />;
};

// Hover Tooltip Component
interface HoverTooltipProps {
  hoverInfo: { content: string; position: { top: number; left: number } } | null;
  fontSize: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const HoverTooltip = ({ hoverInfo, fontSize, onMouseEnter, onMouseLeave }: HoverTooltipProps) => {
  if (!hoverInfo) return null;

  return (
    <div
      className="fixed z-[110] bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg shadow-xl pointer-events-auto"
      style={{
        top: hoverInfo.position.top,
        left: hoverInfo.position.left,
        maxWidth: "400px",
        maxHeight: "300px",
        backdropFilter: "blur(8px)",
        animation: "fadeInUp 0.2s ease-out",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="p-4 overflow-auto scrollbar-hidden">
        {hoverInfo.content.includes("```") ? (
          <div className="space-y-3">
            {hoverInfo.content.split(/```[\w]*\n?/).map((part, index) => {
              const trimmedPart = part.trim();
              if (!trimmedPart) return null;

              if (index % 2 === 1) {
                return (
                  <pre
                    key={index}
                    className="font-mono text-sm bg-[var(--secondary-bg)] p-3 rounded-md border border-[var(--border-color)] text-[var(--text-color)] overflow-x-auto scrollbar-hidden"
                    style={{ fontSize: `${fontSize * 0.85}px` }}
                  >
                    {trimmedPart.replace(/```$/, "")}
                  </pre>
                );
              }
              return trimmedPart ? (
                <div
                  key={index}
                  className="text-sm text-[var(--text-color)] leading-relaxed whitespace-pre-wrap"
                  style={{ fontSize: `${fontSize * 0.9}px` }}
                >
                  {trimmedPart}
                </div>
              ) : null;
            })}
          </div>
        ) : (
          <div
            className="text-sm text-[var(--text-color)] leading-relaxed whitespace-pre-wrap"
            style={{ fontSize: `${fontSize * 0.9}px` }}
          >
            {hoverInfo.content}
          </div>
        )}
      </div>
    </div>
  );
};

// Main CodeEditor Component
const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  (
    {
      value,
      onChange,
      onKeyDown,
      onCursorPositionChange,
      placeholder,
      disabled = false,
      className,
      filename = "",
      vimEnabled = false,
      vimMode = "normal",
      cursorPosition = 0,
      searchQuery = "",
      searchMatches = [],
      currentMatchIndex = -1,
      filePath = "",
      fontSize = 14,
      tabSize = 2,
      wordWrap = false,
      lineNumbers = true,
      aiCompletion = false,
      minimap = false,
      getCompletions,
      getHover,
      isLanguageSupported,
      openDocument: _openDocument,
      changeDocument: _changeDocument,
      closeDocument: _closeDocument,
    },
    ref,
  ) => {
    // Refs
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const highlightRef = useRef<HTMLPreElement | null>(null);
    const lineNumbersRef = useRef<HTMLDivElement | null>(null);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Store subscriptions - only what we need
    const language = useCodeEditorStore(state => state.language);
    const lspCompletions = useCodeEditorStore(state => state.lspCompletions);
    const selectedLspIndex = useCodeEditorStore(state => state.selectedLspIndex);
    const isLspCompletionVisible = useCodeEditorStore(state => state.isLspCompletionVisible);
    const completionPosition = useCodeEditorStore(state => state.completionPosition);
    const hoverInfo = useCodeEditorStore(state => state.hoverInfo);
    const isHovering = useCodeEditorStore(state => state.isHovering);
    const currentCompletion = useCodeEditorStore(state => state.currentCompletion);
    const showCompletion = useCodeEditorStore(state => state.showCompletion);

    // Store actions
    const setFilename = useCodeEditorStore(state => state.setFilename);
    const setFilePath = useCodeEditorStore(state => state.setFilePath);
    const setFontSize = useCodeEditorStore(state => state.setFontSize);
    const setTabSize = useCodeEditorStore(state => state.setTabSize);
    const setWordWrap = useCodeEditorStore(state => state.setWordWrap);
    const setLineNumbers = useCodeEditorStore(state => state.setLineNumbers);
    const setDisabled = useCodeEditorStore(state => state.setDisabled);
    const setVimEnabled = useCodeEditorStore(state => state.setVimEnabled);
    const setVimMode = useCodeEditorStore(state => state.setVimMode);
    const setAiCompletion = useCodeEditorStore(state => state.setAiCompletion);
    const setMinimap = useCodeEditorStore(state => state.setMinimap);
    const setSearchQuery = useCodeEditorStore(state => state.setSearchQuery);
    const setSearchMatches = useCodeEditorStore(state => state.setSearchMatches);
    const setCurrentMatchIndex = useCodeEditorStore(state => state.setCurrentMatchIndex);
    const setValue = useCodeEditorStore(state => state.setValue);
    const setLspCompletions = useCodeEditorStore(state => state.setLspCompletions);
    const setSelectedLspIndex = useCodeEditorStore(state => state.setSelectedLspIndex);
    const setIsLspCompletionVisible = useCodeEditorStore(state => state.setIsLspCompletionVisible);
    const setCompletionPosition = useCodeEditorStore(state => state.setCompletionPosition);
    const setHoverInfo = useCodeEditorStore(state => state.setHoverInfo);
    const setIsHovering = useCodeEditorStore(state => state.setIsHovering);
    const setCurrentCompletion = useCodeEditorStore(state => state.setCurrentCompletion);
    const setShowCompletion = useCodeEditorStore(state => state.setShowCompletion);

    // Initialize hooks
    useCodeHighlighting(highlightRef);
    const { handleKeyDown } = useEditorKeyboard(textareaRef, onChange, onKeyDown);
    const { handleScroll, handleCursorPositionChange, handleUserInteraction } = useEditorScroll(
      textareaRef,
      highlightRef,
      lineNumbersRef,
    );

    // Sync props with store
    useEffect(() => {
      setValue(value);
    }, [value, setValue]);

    useEffect(() => {
      setFilename(filename);
    }, [filename, setFilename]);

    useEffect(() => {
      setFilePath(filePath);
    }, [filePath, setFilePath]);

    useEffect(() => {
      setFontSize(fontSize);
    }, [fontSize, setFontSize]);

    useEffect(() => {
      setTabSize(tabSize);
    }, [tabSize, setTabSize]);

    useEffect(() => {
      setWordWrap(wordWrap);
    }, [wordWrap, setWordWrap]);

    useEffect(() => {
      setLineNumbers(lineNumbers);
    }, [lineNumbers, setLineNumbers]);

    useEffect(() => {
      setDisabled(disabled);
    }, [disabled, setDisabled]);

    useEffect(() => {
      setVimEnabled(vimEnabled);
    }, [vimEnabled, setVimEnabled]);

    useEffect(() => {
      setVimMode(vimMode);
    }, [vimMode, setVimMode]);

    useEffect(() => {
      setAiCompletion(aiCompletion);
    }, [aiCompletion, setAiCompletion]);

    useEffect(() => {
      setMinimap(minimap);
    }, [minimap, setMinimap]);

    useEffect(() => {
      setSearchQuery(searchQuery);
    }, [searchQuery, setSearchQuery]);

    useEffect(() => {
      setSearchMatches(searchMatches);
    }, [searchMatches, setSearchMatches]);

    useEffect(() => {
      setCurrentMatchIndex(currentMatchIndex);
    }, [currentMatchIndex, setCurrentMatchIndex]);

    // Handle imperative ref
    useImperativeHandle(ref, () => ({
      textarea: textareaRef.current,
    }));

    // LSP completion handler
    const handleLspCompletion = useCallback(
      async (cursorPos: number) => {
        if (!getCompletions || !filePath || !isLanguageSupported?.(filePath)) {
          return;
        }

        const isRemoteFile = filePath?.startsWith("remote://");
        if (isRemoteFile) return;

        const lines = value.substring(0, cursorPos).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;

        try {
          const completions = await getCompletions(filePath, line, character);
          if (completions.length > 0) {
            setLspCompletions(completions);
            setSelectedLspIndex(0);
            setIsLspCompletionVisible(true);

            // Calculate completion position
            if (textareaRef.current) {
              const textarea = textareaRef.current;
              const rect = textarea.getBoundingClientRect();
              const lineHeight = fontSize * 1.4;
              const charWidth = fontSize * 0.6;
              const paddingLeft = lineNumbers ? 8 : 16;
              const paddingTop = 16;
              const scrollLeft = textarea.scrollLeft;
              const scrollTop = textarea.scrollTop;

              const x = rect.left + character * charWidth + paddingLeft - scrollLeft;
              const y = rect.top + (line + 1) * lineHeight + paddingTop - scrollTop;

              const dropdownHeight = Math.min(completions.length * 40, 320);
              const dropdownWidth = 320;

              let finalX = x;
              let finalY = y;

              if (finalX + dropdownWidth > window.innerWidth - 10) {
                finalX = Math.max(10, x - dropdownWidth);
              }

              if (finalY + dropdownHeight > window.innerHeight - 10) {
                finalY = Math.max(10, y - dropdownHeight - lineHeight);
              }

              setCompletionPosition({ top: finalY, left: finalX });
            }
          }
        } catch (error) {
          console.error("LSP completion error:", error);
        }
      },
      [
        getCompletions,
        isLanguageSupported,
        filePath,
        value,
        fontSize,
        lineNumbers,
        setLspCompletions,
        setSelectedLspIndex,
        setIsLspCompletionVisible,
        setCompletionPosition,
      ],
    );

    // Apply LSP completion
    const applyLspCompletion = useCallback(
      (completion: CompletionItem) => {
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
      [value, onChange, setIsLspCompletionVisible],
    );

    // Handle completion close
    const handleCompletionClose = useCallback(() => {
      setIsLspCompletionVisible(false);
    }, [setIsLspCompletionVisible]);

    // Handle hover
    const handleHover = useCallback(
      (e: React.MouseEvent<HTMLTextAreaElement>) => {
        if (!getHover || !isLanguageSupported?.(filePath || "")) {
          return;
        }

        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }

        hoverTimeoutRef.current = setTimeout(async () => {
          const textarea = e.currentTarget;
          const rect = textarea.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          const lineHeight = fontSize * 1.4;
          const charWidth = fontSize * 0.6;
          const paddingLeft = lineNumbers ? 8 : 16;
          const paddingTop = 16;

          const line = Math.floor((y - paddingTop + textarea.scrollTop) / lineHeight);
          const character = Math.floor((x - paddingLeft + textarea.scrollLeft) / charWidth);

          if (line >= 0 && character >= 0) {
            try {
              const hoverResult = await getHover(filePath || "", line, character);
              if (hoverResult?.contents) {
                let content = "";

                if (typeof hoverResult.contents === "string") {
                  content = hoverResult.contents;
                } else if (Array.isArray(hoverResult.contents)) {
                  content = hoverResult.contents
                    .map((item: any) => {
                      if (typeof item === "string") {
                        return item;
                      } else if (item.language && item.value) {
                        return `\`\`\`${item.language}\n${item.value}\n\`\`\``;
                      } else if (item.kind === "markdown" && item.value) {
                        return item.value;
                      } else if (item.value) {
                        return item.value;
                      }
                      return "";
                    })
                    .filter(Boolean)
                    .join("\n\n");
                } else if (hoverResult.contents.value) {
                  content = hoverResult.contents.value;
                }

                if (content.trim()) {
                  const tooltipWidth = 400;
                  const tooltipHeight = 200;
                  const margin = 10;

                  let tooltipX = e.clientX + 15;
                  let tooltipY = e.clientY + 15;

                  if (tooltipX + tooltipWidth > window.innerWidth - margin) {
                    tooltipX = e.clientX - tooltipWidth - 15;
                  }

                  if (tooltipY + tooltipHeight > window.innerHeight - margin) {
                    tooltipY = e.clientY - tooltipHeight - 15;
                  }

                  tooltipX = Math.max(
                    margin,
                    Math.min(tooltipX, window.innerWidth - tooltipWidth - margin),
                  );
                  tooltipY = Math.max(
                    margin,
                    Math.min(tooltipY, window.innerHeight - tooltipHeight - margin),
                  );

                  setHoverInfo({
                    content: content.trim(),
                    position: { top: tooltipY, left: tooltipX },
                  });
                }
              }
            } catch (error) {
              console.error("LSP hover error:", error);
            }
          }
        }, 300);
      },
      [getHover, isLanguageSupported, filePath, fontSize, lineNumbers, setHoverInfo],
    );

    // Handle AI completion
    useEffect(() => {
      if (!aiCompletion || !textareaRef.current) return;

      const textarea = textareaRef.current;
      const handleAiCompletion = async () => {
        const cursorPos = textarea.selectionStart;
        const textBeforeCursor = value.substring(0, cursorPos);

        if (textBeforeCursor.trim().length < 3) return;

        try {
          requestCompletion(
            {
              code: textBeforeCursor,
              language,
              filename: filename || "",
              cursorPosition: cursorPos,
            },
            completion => {
              if (completion?.completion) {
                setCurrentCompletion(completion);
                setShowCompletion(true);
              }
            },
          );
        } catch (error) {
          console.error("AI completion error:", error);
        }
      };

      const timeoutId = setTimeout(handleAiCompletion, 500);
      return () => clearTimeout(timeoutId);
    }, [value, language, aiCompletion, setCurrentCompletion, setShowCompletion]);

    // Handle completion acceptance
    const handleAcceptCompletion = useCallback(() => {
      if (!currentCompletion || !textareaRef.current) return;

      const currentCursorPos = textareaRef.current.selectionStart;
      const newValue =
        value.substring(0, currentCursorPos) +
        currentCompletion.completion +
        value.substring(currentCursorPos);

      onChange(newValue);
      setShowCompletion(false);
      setCurrentCompletion(null);

      requestAnimationFrame(() => {
        if (textareaRef.current) {
          const newCursorPos = currentCursorPos + currentCompletion.completion.length;
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          textareaRef.current.focus();
        }
      });
    }, [currentCompletion, value, onChange, setShowCompletion, setCurrentCompletion]);

    // Handle completion dismissal
    const handleDismissCompletion = useCallback(() => {
      setShowCompletion(false);
      setCurrentCompletion(null);
      cancelCompletion();
    }, [setShowCompletion, setCurrentCompletion]);

    // Handle mouse events
    const handleMouseLeave = useCallback(() => {
      setIsHovering(false);
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      setTimeout(() => {
        if (!isHovering) {
          setHoverInfo(null);
        }
      }, 150);
    }, [isHovering, setIsHovering, setHoverInfo]);

    const handleMouseEnter = useCallback(() => {
      setIsHovering(true);
    }, [setIsHovering]);

    // Calculate styles
    const getTextareaClasses = useMemo(() => {
      let classes = `absolute top-0 bottom-0 right-0 left-0 m-0 p-4 font-mono leading-6 text-transparent bg-transparent border-none outline-none resize-none overflow-auto z-[2] shadow-none rounded-none transition-none`;

      if (wordWrap) {
        classes += " whitespace-pre-wrap break-words";
      } else {
        classes += " whitespace-pre";
      }

      if (lineNumbers) {
        classes += " pl-2";
      } else {
        classes += " pl-4";
      }

      if (vimEnabled) {
        classes += " bg-[var(--primary-bg)]";
        if (vimMode === "normal") {
          classes += " caret-transparent";
        } else {
          classes += " caret-[var(--text-color)]";
        }
        if (vimMode === "visual") {
          classes += " vim-visual-selection";
        }
      } else {
        classes += " caret-[var(--text-color)]";
      }

      return classes;
    }, [wordWrap, lineNumbers, vimEnabled, vimMode]);

    const getEditorStyles = useMemo(() => {
      return {
        fontSize: `${fontSize}px`,
        tabSize: tabSize,
        lineHeight: `${fontSize * 1.4}px`,
      };
    }, [fontSize, tabSize]);

    // Calculate line numbers
    const lineNumbersArray = useMemo(() => {
      const lines = value.split("\n");
      return Array.from({ length: lines.length }, (_, i) => i + 1);
    }, [value]);

    return (
      <div className="flex-1 relative flex flex-col h-full">
        <div className="flex-1 relative overflow-hidden flex h-full">
          {/* Line numbers */}
          {lineNumbers && (
            <div className="w-12 bg-[var(--secondary-bg)] relative overflow-hidden border-r border-[var(--border-color)]">
              <div
                ref={lineNumbersRef}
                className="absolute inset-0 p-4 pr-2 pt-4 font-mono text-right select-none pointer-events-none overflow-hidden"
                style={{
                  fontSize: `${fontSize * 0.85}px`,
                  lineHeight: `${fontSize * 1.4}px`,
                  color: "var(--text-lighter)",
                }}
              >
                {lineNumbersArray.map(num => (
                  <div key={num} style={{ height: `${fontSize * 1.4}px` }}>
                    {num}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Editor content area */}
          <div className="flex-1 relative overflow-hidden h-full">
            {/* Syntax highlighting layer */}
            <pre
              ref={highlightRef}
              className={`absolute top-0 bottom-0 right-0 left-0 m-0 p-4 font-mono text-[var(--text-color)] bg-transparent border-none outline-none overflow-auto pointer-events-none z-[1] ${wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
              style={{
                ...getEditorStyles,
                paddingLeft: lineNumbers ? "8px" : "16px",
              }}
              aria-hidden="true"
            />

            {/* Textarea for input */}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={e => {
                handleUserInteraction();
                onChange(e.target.value);
              }}
              onKeyDown={e => {
                handleUserInteraction();
                handleKeyDown(e);
              }}
              onKeyUp={() =>
                handleCursorPositionChange(
                  onCursorPositionChange,
                  filePath,
                  isLanguageSupported,
                  vimEnabled,
                  vimMode,
                  handleLspCompletion,
                )
              }
              onClick={() => {
                handleUserInteraction();
                handleCursorPositionChange(
                  onCursorPositionChange,
                  filePath,
                  isLanguageSupported,
                  vimEnabled,
                  vimMode,
                  handleLspCompletion,
                );
              }}
              onScroll={handleScroll}
              onMouseMove={handleHover}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(getTextareaClasses, className)}
              style={{
                ...getEditorStyles,
                paddingLeft: lineNumbers ? "8px" : "16px",
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
            />

            {/* AI Completion */}
            {(!vimEnabled || vimMode === "insert") && (
              <InlineCompletion
                textareaRef={textareaRef as React.RefObject<HTMLTextAreaElement>}
                completion={currentCompletion?.completion || ""}
                cursorPosition={textareaRef.current?.selectionStart || 0}
                visible={showCompletion}
                onAccept={handleAcceptCompletion}
                onDismiss={handleDismissCompletion}
              />
            )}

            {/* Vim cursor for normal mode */}
            {vimEnabled && vimMode === "normal" && (
              <VimCursor textareaRef={textareaRef} cursorPosition={cursorPosition} visible={true} />
            )}
          </div>

          {minimap && <MinimapPane content={value} textareaRef={textareaRef} fontSize={fontSize} />}
        </div>

        {/* LSP Completion Dropdown */}
        {isLspCompletionVisible && (
          <CompletionDropdown
            items={lspCompletions}
            selectedIndex={selectedLspIndex}
            onSelect={applyLspCompletion}
            onClose={handleCompletionClose}
            position={completionPosition}
          />
        )}

        {/* Hover Tooltip */}
        <HoverTooltip
          hoverInfo={hoverInfo}
          fontSize={fontSize}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      </div>
    );
  },
);

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
