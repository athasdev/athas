import Prism from "prismjs";
import type React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";
import {
  type CompletionResponse,
  cancelCompletion,
  requestCompletion,
} from "../utils/ai-completion";
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

// Language detection based on file extension
const getLanguageFromFilename = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase();

  const languageMap: { [key: string]: string } = {
    rb: "ruby",
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    java: "java",
    css: "css",
    scss: "css",
    sass: "css",
    json: "json",
    md: "markdown",
    markdown: "markdown",
    sh: "bash",
    bash: "bash",
    yml: "yaml",
    yaml: "yaml",
    sql: "sql",
    html: "markup",
    xml: "markup",
    php: "php",
    phtml: "php",
    php3: "php",
    php4: "php",
    php5: "php",
    php7: "php",
    cs: "csharp",
    rs: "rust",
    toml: "toml",
  };

  return languageMap[ext || ""] || "text";
};

// Helper function to escape HTML entities
const escapeHtml = (text: string): string => {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
};

// Helper function to safely highlight code with proper HTML escaping
const safeHighlight = (code: string, language: string): string => {
  // For all languages, let Prism.js handle the syntax highlighting
  // Prism.js properly escapes content internally when generating highlighted HTML
  try {
    return Prism.highlight(code, Prism.languages[language] || Prism.languages.text, language);
  } catch (_error) {
    // If highlighting fails, escape and return as plain text
    return escapeHtml(code);
  }
};

interface VimCursorProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  cursorPosition: number;
  visible: boolean;
}

const VimCursor = ({ textareaRef, cursorPosition, visible }: VimCursorProps) => {
  const [cursorStyle, setCursorStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!textareaRef.current || !visible) {
      setCursorStyle({ display: "none" });
      return;
    }

    const textarea = textareaRef.current;
    const text = textarea.value;

    // Create a temporary element to measure text
    const measureElement = document.createElement("div");
    measureElement.style.position = "absolute";
    measureElement.style.visibility = "hidden";
    measureElement.style.whiteSpace = "pre";
    measureElement.style.fontFamily = getComputedStyle(textarea).fontFamily;
    measureElement.style.fontSize = getComputedStyle(textarea).fontSize;
    measureElement.style.lineHeight = getComputedStyle(textarea).lineHeight;
    measureElement.style.padding = "0";
    measureElement.style.margin = "0";
    measureElement.style.border = "none";

    document.body.appendChild(measureElement);

    // Get text before cursor
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lines = textBeforeCursor.split("\n");
    const currentLineIndex = lines.length - 1;
    const currentLineText = lines[currentLineIndex];

    // Measure line height
    measureElement.textContent = "M";
    const lineHeight = measureElement.offsetHeight;

    // Measure character width at cursor position
    measureElement.textContent = currentLineText;
    const lineWidth = measureElement.offsetWidth;

    // Calculate cursor position - account for padding and line numbers offset
    const top = currentLineIndex * lineHeight + 16; // 16px padding
    const left = lineWidth + 8; // 8px padding-left (pl-2)

    document.body.removeChild(measureElement);

    setCursorStyle({
      position: "absolute",
      top: `${top}px`,
      left: `${left}px`,
      width: "8px",
      height: `${lineHeight}px`,
      backgroundColor: "var(--text-color)",
      opacity: 0.8,
      pointerEvents: "none",
      zIndex: 10,
      animation: "vim-cursor-blink 1s infinite",
      display: "block",
    });
  }, [textareaRef, cursorPosition, visible]);

  return <div style={cursorStyle} />;
};

const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  (
    {
      value,
      onChange,
      onKeyDown,
      onCursorPositionChange,
      placeholder,
      disabled,
      className,
      filename = "",
      vimEnabled = false,
      vimMode = "normal",
      cursorPosition = 0,
      searchQuery = "",
      searchMatches = [],
      currentMatchIndex = -1,
      filePath,
      fontSize = 14,
      tabSize = 2,
      wordWrap = true,
      lineNumbers = true,
      aiCompletion = true,
      minimap = false,
      getCompletions,
      getHover,
      isLanguageSupported,
      openDocument,
      changeDocument,
      closeDocument,
    },
    ref,
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const highlightRef = useRef<HTMLPreElement>(null);
    const lineNumbersRef = useRef<HTMLDivElement>(null);
    const [language, setLanguage] = useState<string>("text");
    const [currentCompletion, setCurrentCompletion] = useState<CompletionResponse | null>(null);
    const [showCompletion, setShowCompletion] = useState(false);
    const [lastCursorPosition, setLastCursorPosition] = useState(0);

    // Refs to track timeouts for cleanup
    const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // LSP completion state
    const [lspCompletions, setLspCompletions] = useState<CompletionItem[]>([]);
    const [isLspCompletionVisible, setIsLspCompletionVisible] = useState(false);
    const [selectedLspIndex, setSelectedLspIndex] = useState(0);
    const [completionPosition, setCompletionPosition] = useState({
      top: 0,
      left: 0,
    });

    // Hover tooltip state
    const [hoverInfo, setHoverInfo] = useState<{
      content: string;
      position: { top: number; left: number };
    } | null>(null);
    const [isHovering, setIsHovering] = useState(false);

    // Expose textarea ref to parent
    useImperativeHandle(ref, () => ({
      textarea: textareaRef.current,
    }));

    // Update language when filename changes
    useEffect(() => {
      const detectedLanguage = getLanguageFromFilename(filename);
      setLanguage(detectedLanguage);
    }, [filename]);

    // Open/close document with LSP - make async to avoid blocking file loading
    useEffect(() => {
      if (filePath && openDocument && isLanguageSupported?.(filePath)) {
        // Run LSP opening asynchronously to not block file loading
        const openLspDocument = async () => {
          try {
            await openDocument(filePath, value);
          } catch (error) {
            console.error("LSP open document error:", error);
          }
        };

        // Use requestIdleCallback to run when browser is idle
        if ("requestIdleCallback" in window) {
          requestIdleCallback(() => openLspDocument(), { timeout: 1000 });
        } else {
          setTimeout(openLspDocument, 0);
        }

        return () => {
          if (closeDocument) {
            closeDocument(filePath).catch(error => {
              console.error("LSP close document error:", error);
            });
          }
        };
      }
    }, [filePath, openDocument, closeDocument, isLanguageSupported]);

    // Update LSP when content changes (debounced)
    const debouncedChangeDocument = useCallback(
      (newValue: string) => {
        if (filePath && changeDocument && isLanguageSupported?.(filePath)) {
          changeDocument(filePath, newValue);
        }
      },
      [filePath, changeDocument, isLanguageSupported],
    );

    useEffect(() => {
      // Clear previous timeout
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }

      // Debounce the LSP document change
      highlightTimeoutRef.current = setTimeout(() => {
        debouncedChangeDocument(value);
      }, 150); // Reduced debounce time for better responsiveness

      return () => {
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }
      };
    }, [value, debouncedChangeDocument]);

    // Handle hover to show type information
    const handleHover = useCallback(
      async (e: React.MouseEvent) => {
        const current = currentValuesRef.current;
        if (!getHover || !current.filePath || !isLanguageSupported?.(current.filePath)) {
          return;
        }
        const isRemoteFile = current.filePath?.startsWith("remote://");
        if (isRemoteFile) return;

        const textarea = textareaRef.current;
        if (!textarea) return;

        // Clear existing timeout
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }

        // Calculate position more accurately
        const rect = textarea.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Get computed styles for accurate measurements
        const style = window.getComputedStyle(textarea);
        const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;

        // More accurate character width calculation
        const measureElement = document.createElement("div");
        measureElement.style.fontFamily = style.fontFamily;
        measureElement.style.fontSize = style.fontSize;
        measureElement.style.visibility = "hidden";
        measureElement.style.position = "absolute";
        measureElement.style.whiteSpace = "pre";
        measureElement.style.padding = "0";
        measureElement.style.margin = "0";
        measureElement.textContent = "M".repeat(10); // Measure multiple chars for accuracy
        document.body.appendChild(measureElement);
        const charWidth = measureElement.offsetWidth / 10;
        document.body.removeChild(measureElement);

        // Account for padding
        const paddingLeft = lineNumbers ? 8 : 16;
        const paddingTop = 16;

        // Calculate line and character position
        const adjustedY = y + textarea.scrollTop - paddingTop;
        const adjustedX = x + textarea.scrollLeft - paddingLeft;

        const line = Math.floor(adjustedY / lineHeight);
        const character = Math.max(0, Math.floor(adjustedX / charWidth));

        const lines = current.value.split("\n");

        // Validate position bounds
        if (line < 0 || line >= lines.length) return;
        if (character < 0 || character >= (lines[line]?.length || 0)) return;

        // Set timeout for hover with reduced delay for better responsiveness
        hoverTimeoutRef.current = setTimeout(async () => {
          try {
            const hoverResult = await getHover(current.filePath!, line, character);
            if (hoverResult?.contents) {
              let content = "";

              // Handle different content formats
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
              } else if (hoverResult.contents.language && hoverResult.contents.value) {
                content = `\`\`\`${hoverResult.contents.language}\n${hoverResult.contents.value}\n\`\`\``;
              } else if (hoverResult.contents.kind === "markdown" && hoverResult.contents.value) {
                content = hoverResult.contents.value;
              } else if (hoverResult.contents.value) {
                content = hoverResult.contents.value;
              }

              if (content.trim()) {
                // Better tooltip positioning with screen edge detection
                const tooltipWidth = 400;
                const tooltipHeight = 200;
                const margin = 10;

                let tooltipX = e.clientX + 15;
                let tooltipY = e.clientY + 15;

                // Adjust horizontal position if tooltip would go off-screen
                if (tooltipX + tooltipWidth > window.innerWidth - margin) {
                  tooltipX = e.clientX - tooltipWidth - 15;
                }

                // Adjust vertical position if tooltip would go off-screen
                if (tooltipY + tooltipHeight > window.innerHeight - margin) {
                  tooltipY = e.clientY - tooltipHeight - 15;
                }

                // Ensure tooltip stays on screen
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
        }, 300); // Reduced delay for better responsiveness
      },
      [getHover, isLanguageSupported, fontSize, lineNumbers], // Stable dependencies only
    );

    // LSP completion - using refs for stability
    const handleLspCompletion = useCallback(
      async (cursorPos: number) => {
        const current = currentValuesRef.current;
        if (!getCompletions || !current.filePath || !isLanguageSupported?.(current.filePath)) {
          return;
        }

        const isRemoteFile = current.filePath?.startsWith("remote://");
        if (isRemoteFile) return;

        const lines = current.value.substring(0, cursorPos).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;

        try {
          const completions = await getCompletions(current.filePath, line, character);
          if (completions.length > 0) {
            setLspCompletions(completions);
            setSelectedLspIndex(0);
            setIsLspCompletionVisible(true);

            // More accurate positioning calculation
            if (textareaRef.current) {
              const textarea = textareaRef.current;
              const rect = textarea.getBoundingClientRect();
              const style = window.getComputedStyle(textarea);
              const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;

              // Accurate character width measurement
              const measureElement = document.createElement("div");
              measureElement.style.fontFamily = style.fontFamily;
              measureElement.style.fontSize = style.fontSize;
              measureElement.style.visibility = "hidden";
              measureElement.style.position = "absolute";
              measureElement.style.whiteSpace = "pre";
              measureElement.style.padding = "0";
              measureElement.style.margin = "0";
              measureElement.textContent = "M".repeat(10);
              document.body.appendChild(measureElement);
              const charWidth = measureElement.offsetWidth / 10;
              document.body.removeChild(measureElement);

              // Account for padding and scroll
              const paddingLeft = lineNumbers ? 8 : 16;
              const paddingTop = 16;

              // Calculate absolute position
              const scrollLeft = textarea.scrollLeft;
              const scrollTop = textarea.scrollTop;

              const x = rect.left + character * charWidth + paddingLeft - scrollLeft;
              const y = rect.top + (line + 1) * lineHeight + paddingTop - scrollTop;

              // Ensure dropdown is visible on screen
              const dropdownHeight = Math.min(completions.length * 40, 320);
              const dropdownWidth = 320;

              let finalX = x;
              let finalY = y;

              // Adjust if dropdown would go off right edge
              if (finalX + dropdownWidth > window.innerWidth - 10) {
                finalX = Math.max(10, x - dropdownWidth);
              }

              // Adjust if dropdown would go off bottom edge
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
      [getCompletions, isLanguageSupported, fontSize, lineNumbers], // Minimal stable dependencies
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
      [value, onChange],
    );

    // Memoized completion close handler
    const handleCompletionClose = useCallback(() => {
      setIsLspCompletionVisible(false);
    }, []);

    // Store current values in refs to avoid dependency issues
    const currentValuesRef = useRef({
      disabled,
      vimEnabled,
      vimMode,
      filePath,
      aiCompletion,
      language,
      filename,
      value,
    });

    // Update refs when values change
    useEffect(() => {
      currentValuesRef.current = {
        disabled,
        vimEnabled,
        vimMode,
        filePath,
        aiCompletion,
        language,
        filename,
        value,
      };
    }, [disabled, vimEnabled, vimMode, filePath, aiCompletion, language, filename, value]);

    // Completion trigger with improved logic - stable version
    const handleCompletionTrigger = useCallback(
      (cursorPos: number, triggerChar?: string) => {
        const current = currentValuesRef.current;
        if (current.disabled || !textareaRef.current) return;
        if (current.vimEnabled && current.vimMode !== "insert") return;
        const isRemoteFile = current.filePath?.startsWith("remote://");
        if (isRemoteFile) return;

        // Check if we should trigger completion based on context
        const shouldTriggerLsp = isLanguageSupported?.(current.filePath || "");
        const shouldTriggerAi = !shouldTriggerLsp && current.aiCompletion;

        // Get context around cursor for smarter triggering
        const textBeforeCursor = current.value.substring(Math.max(0, cursorPos - 10), cursorPos);
        const textAfterCursor = current.value.substring(
          cursorPos,
          Math.min(current.value.length, cursorPos + 5),
        );

        // LSP completion triggers
        const lspTriggerChars = [".", ":", ">", "(", "<", " "];
        const isLspTrigger = triggerChar && lspTriggerChars.includes(triggerChar);
        const isWordCharacter = /[a-zA-Z0-9_]/.test(triggerChar || "");
        const hasWordPrefix = /[a-zA-Z_]\w*$/.test(textBeforeCursor);

        if (shouldTriggerLsp && (isLspTrigger || (isWordCharacter && hasWordPrefix))) {
          handleLspCompletion(cursorPos);
        } else if (shouldTriggerAi) {
          // Only trigger AI completion for meaningful context
          const isAtEndOfLine = /\s*$/.test(textAfterCursor);
          const hasMinimumContext = textBeforeCursor.trim().length >= 2;

          if (isAtEndOfLine && hasMinimumContext) {
            cancelCompletion();
            setShowCompletion(false);
            requestCompletion(
              {
                code: current.value,
                language: current.language,
                filename: current.filename,
                cursorPosition: cursorPos,
              },
              completion => {
                if (completion?.completion.trim()) {
                  setCurrentCompletion(completion);
                  setShowCompletion(true);
                }
              },
            );
          }
        }
      },
      [isLanguageSupported, handleLspCompletion], // Minimal stable dependencies
    );

    // Debounced completion trigger - using ref to avoid dependency issues
    const debouncedCompletionTrigger = useCallback(
      (newValue: string, oldValue: string) => {
        if (!textareaRef.current) return;
        const currentCursorPos = textareaRef.current.selectionStart;

        // Clear any existing timeout
        if (completionTimeoutRef.current) {
          clearTimeout(completionTimeoutRef.current);
        }

        // Get the character that was just typed
        let triggerChar: string | undefined;
        if (newValue.length > oldValue.length && currentCursorPos > 0) {
          triggerChar = newValue.charAt(currentCursorPos - 1);
        }

        // Determine delay based on trigger character and context
        const isInstantTrigger = triggerChar && [".", ":", ">", "("].includes(triggerChar);
        const delay = isInstantTrigger ? 50 : 300; // Faster for trigger chars

        // Set timeout for completion
        completionTimeoutRef.current = setTimeout(() => {
          handleCompletionTrigger(currentCursorPos, triggerChar);
        }, delay);

        setLastCursorPosition(currentCursorPos);
      },
      [], // Empty dependency array to prevent recreation
    );

    // Track previous value for comparison
    const previousValueRef = useRef(value);

    // --- EFFECTS ---
    useEffect(() => {
      // Only trigger completion if the value actually changed meaningfully
      if (!textareaRef.current) return;

      const currentCursorPos = textareaRef.current.selectionStart;
      const previousValue = previousValueRef.current;

      // Update previous value
      previousValueRef.current = value;

      // Only trigger if cursor moved forward (typing) and within reasonable bounds
      if (currentCursorPos > lastCursorPosition && currentCursorPos - lastCursorPosition <= 3) {
        const triggerTimer = setTimeout(() => {
          debouncedCompletionTrigger(value, previousValue);
        }, 100); // Reduced initial delay

        return () => {
          clearTimeout(triggerTimer);
          if (completionTimeoutRef.current) {
            clearTimeout(completionTimeoutRef.current);
          }
        };
      }
    }, [value, lastCursorPosition]); // Removed debouncedCompletionTrigger from dependencies

    // Cleanup completion on unmount
    useEffect(() => {
      return () => {
        cancelCompletion();
        // Clean up any pending timeouts
        if (completionTimeoutRef.current) {
          clearTimeout(completionTimeoutRef.current);
        }
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }
      };
    }, []);

    // Function to add search highlighting to syntax highlighted content (memoized)
    const addSearchHighlighting = useMemo(() => {
      return (content: string): string => {
        if (!searchQuery || searchMatches.length === 0) {
          return content;
        }

        // Create a temporary div to work with the highlighted content
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = content;

        // Sort matches by start position (descending) to process from end to beginning
        const sortedMatches = [...searchMatches].sort((a, b) => b.start - a.start);

        // Process each match from end to beginning to avoid position shifts
        sortedMatches.forEach(match => {
          const originalIndex = searchMatches.indexOf(match);
          const isCurrentMatch = originalIndex === currentMatchIndex;
          const matchClass = isCurrentMatch
            ? "bg-orange-400 text-black font-semibold"
            : "bg-yellow-300 text-black";

          // Find the position in the HTML where this text match occurs
          const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null);

          let currentPos = 0;
          let node: Node | null;

          while (true) {
            node = walker.nextNode();
            if (!node) break;
            const nodeText = node.textContent || "";
            const nodeStart = currentPos;
            const nodeEnd = currentPos + nodeText.length;

            if (match.start >= nodeStart && match.end <= nodeEnd) {
              // Match is within this text node
              const relativeStart = match.start - nodeStart;
              const relativeEnd = match.end - nodeStart;

              const beforeText = nodeText.substring(0, relativeStart);
              const matchText = nodeText.substring(relativeStart, relativeEnd);
              const afterText = nodeText.substring(relativeEnd);

              // Create the replacement HTML
              const replacement = document.createElement("span");
              replacement.innerHTML = `${beforeText}<span class="${matchClass}">${matchText}</span>${afterText}`;

              // Replace the text node with our highlighted version
              const parent = node.parentNode;
              if (parent) {
                while (replacement.firstChild) {
                  parent.insertBefore(replacement.firstChild, node);
                }
                parent.removeChild(node);
              }
              break;
            }

            currentPos = nodeEnd;
          }
        });

        return tempDiv.innerHTML;
      };
    }, [searchQuery, searchMatches, currentMatchIndex]);

    // Highlight code when value, language, or search changes (optimized debouncing)
    useEffect(() => {
      // Clear previous timeout to prevent accumulation
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }

      const isRemoteFile = filePath?.startsWith("remote://");

      // Reduced debounce times for better responsiveness
      const debounceTime = isRemoteFile ? 300 : 16; // ~1 frame for local files

      highlightTimeoutRef.current = setTimeout(() => {
        const performHighlighting = () => {
          if (highlightRef.current && language !== "text") {
            try {
              const highlighted = safeHighlight(value, language);
              const withSearchHighlighting = addSearchHighlighting(highlighted);
              highlightRef.current.innerHTML = withSearchHighlighting;
            } catch (_error) {
              // Fallback to escaped plain text if highlighting fails
              const escapedValue = escapeHtml(value);
              const withSearchHighlighting = addSearchHighlighting(escapedValue);
              highlightRef.current.innerHTML = withSearchHighlighting;
            }
          } else if (highlightRef.current) {
            // For plain text, still escape HTML to prevent unwanted rendering
            const escapedValue = escapeHtml(value);
            const withSearchHighlighting = addSearchHighlighting(escapedValue);
            highlightRef.current.innerHTML = withSearchHighlighting;
          }
        };

        if (isRemoteFile && "requestIdleCallback" in window) {
          // For remote files, use requestIdleCallback to run when browser is idle
          requestIdleCallback(performHighlighting, { timeout: 1000 });
        } else {
          performHighlighting();
        }
      }, debounceTime);

      return () => {
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }
      };
    }, [value, language, addSearchHighlighting, filePath]);

    // Sync scroll between textarea, highlight layer, and line numbers
    const handleScroll = useCallback(() => {
      if (textareaRef.current && highlightRef.current && lineNumbersRef.current) {
        const scrollTop = textareaRef.current.scrollTop;
        const scrollLeft = textareaRef.current.scrollLeft;

        highlightRef.current.scrollTop = scrollTop;
        highlightRef.current.scrollLeft = scrollLeft;
        lineNumbersRef.current.scrollTop = scrollTop;
      }
    }, []);

    // Handle cursor position changes
    const handleCursorPositionChange = useCallback(() => {
      if (textareaRef.current && onCursorPositionChange) {
        const position = textareaRef.current.selectionStart;
        onCursorPositionChange(position);

        // Skip LSP for remote files to avoid delays
        const isRemoteFile = filePath?.startsWith("remote://");

        // Trigger LSP completion if supported and in insert mode (or vim disabled) - but not for remote files
        if (
          !isRemoteFile &&
          isLanguageSupported?.(filePath || "") &&
          (!vimEnabled || vimMode === "insert")
        ) {
          handleLspCompletion(position);
        }
      }
    }, [
      onCursorPositionChange,
      filePath,
      isLanguageSupported,
      vimEnabled,
      vimMode,
      handleLspCompletion,
    ]);

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

      // Move cursor to end of inserted completion
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          const newCursorPos = currentCursorPos + currentCompletion.completion.length;
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          textareaRef.current.focus();
        }
      });
    }, [currentCompletion, value, onChange]);

    // Handle completion dismissal
    const handleDismissCompletion = useCallback(() => {
      setShowCompletion(false);
      setCurrentCompletion(null);
      cancelCompletion();
    }, []);

    // Handle mouse leave to hide hover
    const handleMouseLeave = useCallback(() => {
      setIsHovering(false);
      // Clear hover timeout if mouse leaves
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      // Small delay before hiding to allow moving to tooltip
      setTimeout(() => {
        if (!isHovering) {
          setHoverInfo(null);
        }
      }, 150);
    }, [isHovering]);

    const handleMouseEnter = useCallback(() => {
      setIsHovering(true);
    }, []);

    // Hide hover info when user starts typing or interacting
    const handleUserInteraction = useCallback(() => {
      setHoverInfo(null);
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    }, []);

    const getTextareaClasses = useMemo(() => {
      // Always use transparent text so syntax highlighting layer shows through
      let classes = `absolute top-0 bottom-0 right-0 left-0 m-0 p-4 font-mono leading-6 text-transparent bg-transparent border-none outline-none resize-none overflow-auto z-[2] shadow-none rounded-none transition-none`;

      // Add word wrap classes
      if (wordWrap) {
        classes += " whitespace-pre-wrap break-words";
      } else {
        classes += " whitespace-pre";
      }

      // Add left padding based on line numbers
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
        // When vim is disabled, show normal cursor
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

    // Calculate line numbers (memoized to avoid recalculation on every render)
    const lineNumbersArray = useMemo(() => {
      const lineCount = value.split("\n").length;
      // Limit line numbers for performance - don't render more than 10,000 lines
      const maxLines = Math.min(lineCount, 10000);
      return Array.from({ length: maxLines }, (_, i) => i + 1);
    }, [value]);

    // Memoized key handlers to prevent recreation on every render
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Handle LSP completion navigation
        if (isLspCompletionVisible) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedLspIndex(prev => (prev < lspCompletions.length - 1 ? prev + 1 : 0));
            return;
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedLspIndex(prev => (prev > 0 ? prev - 1 : lspCompletions.length - 1));
            return;
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            if (lspCompletions[selectedLspIndex]) {
              applyLspCompletion(lspCompletions[selectedLspIndex]);
            }
            return;
          } else if (e.key === "Escape") {
            e.preventDefault();
            setIsLspCompletionVisible(false);
            return;
          }
        }

        // Handle code editor shortcuts (before vim mode to allow vim to override if needed)
        const textarea = textareaRef.current;
        if (textarea && !disabled) {
          const { selectionStart, selectionEnd } = textarea;
          const currentValue = textarea.value;
          const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
          const cmdKey = isMac ? e.metaKey : e.ctrlKey;

          // Tab for indentation
          if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            const spaces = " ".repeat(tabSize);

            if (selectionStart === selectionEnd) {
              // No selection - insert tab at cursor
              const newValue =
                currentValue.substring(0, selectionStart) +
                spaces +
                currentValue.substring(selectionStart);
              onChange(newValue);

              requestAnimationFrame(() => {
                if (textarea) {
                  const newPos = selectionStart + spaces.length;
                  textarea.setSelectionRange(newPos, newPos);
                }
              });
            } else {
              // Has selection - indent selected lines
              const lines = currentValue.split("\n");
              const startLine = currentValue.substring(0, selectionStart).split("\n").length - 1;
              const endLine = currentValue.substring(0, selectionEnd).split("\n").length - 1;

              for (let i = startLine; i <= endLine; i++) {
                lines[i] = spaces + lines[i];
              }

              const newValue = lines.join("\n");
              onChange(newValue);

              requestAnimationFrame(() => {
                if (textarea) {
                  const newStart = selectionStart + spaces.length;
                  const newEnd = selectionEnd + spaces.length * (endLine - startLine + 1);
                  textarea.setSelectionRange(newStart, newEnd);
                }
              });
            }
            return;
          }

          // Shift+Tab for unindentation
          if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            const lines = currentValue.split("\n");
            const startLine = currentValue.substring(0, selectionStart).split("\n").length - 1;
            const endLine = currentValue.substring(0, selectionEnd).split("\n").length - 1;

            let removedChars = 0;
            for (let i = startLine; i <= endLine; i++) {
              const line = lines[i];
              const leadingSpaces = line.match(/^ */)?.[0].length || 0;
              const spacesToRemove = Math.min(leadingSpaces, tabSize);
              lines[i] = line.substring(spacesToRemove);
              if (i === startLine) removedChars = spacesToRemove;
            }

            const newValue = lines.join("\n");
            onChange(newValue);

            requestAnimationFrame(() => {
              if (textarea) {
                const newStart = Math.max(0, selectionStart - removedChars);
                const totalRemoved = (endLine - startLine + 1) * Math.min(tabSize, 2); // Estimate
                const newEnd = Math.max(newStart, selectionEnd - totalRemoved);
                textarea.setSelectionRange(newStart, newEnd);
              }
            });
            return;
          }

          // Alt/Option + Arrow Up/Down for moving lines
          if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            const lines = currentValue.split("\n");
            const currentLine = currentValue.substring(0, selectionStart).split("\n").length - 1;
            const targetLine = e.key === "ArrowUp" ? currentLine - 1 : currentLine + 1;

            if (targetLine >= 0 && targetLine < lines.length) {
              // Swap lines
              [lines[currentLine], lines[targetLine]] = [lines[targetLine], lines[currentLine]];
              const newValue = lines.join("\n");
              onChange(newValue);

              requestAnimationFrame(() => {
                if (textarea) {
                  // Calculate new cursor position
                  const targetLineStart =
                    lines.slice(0, targetLine).join("\n").length + (targetLine > 0 ? 1 : 0);
                  const currentLineText = lines[targetLine];
                  const cursorOffsetInLine =
                    selectionStart -
                    (currentValue.substring(0, selectionStart).lastIndexOf("\n") + 1);
                  const newPos =
                    targetLineStart + Math.min(cursorOffsetInLine, currentLineText.length);
                  textarea.setSelectionRange(newPos, newPos);
                }
              });
            }
            return;
          }

          // Cmd/Ctrl + D for duplicate line
          if (cmdKey && e.key === "d") {
            e.preventDefault();
            const lines = currentValue.split("\n");
            const currentLine = currentValue.substring(0, selectionStart).split("\n").length - 1;
            const lineToClone = lines[currentLine];

            lines.splice(currentLine + 1, 0, lineToClone);
            const newValue = lines.join("\n");
            onChange(newValue);

            requestAnimationFrame(() => {
              if (textarea) {
                const newPos = selectionStart + lineToClone.length + 1;
                textarea.setSelectionRange(newPos, newPos);
              }
            });
            return;
          }

          // Cmd/Ctrl + / for toggle comment
          if (cmdKey && e.key === "/") {
            e.preventDefault();
            const lines = currentValue.split("\n");
            const startLine = currentValue.substring(0, selectionStart).split("\n").length - 1;
            const endLine = currentValue.substring(0, selectionEnd).split("\n").length - 1;

            // Determine comment syntax based on language
            const getCommentSyntax = (lang: string) => {
              const singleLineComments: { [key: string]: string } = {
                javascript: "//",
                typescript: "//",
                java: "//",
                css: "/*",
                python: "#",
                ruby: "#",
                bash: "#",
                yaml: "#",
                sql: "--",
              };
              return singleLineComments[lang] || "//";
            };

            const commentPrefix = getCommentSyntax(language);
            const commentPattern = new RegExp(
              `^(\\s*)${commentPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s?`,
            );

            // Check if all selected lines are commented
            const allCommented = lines
              .slice(startLine, endLine + 1)
              .every(line => line.trim() === "" || commentPattern.test(line));

            for (let i = startLine; i <= endLine; i++) {
              if (lines[i].trim() === "") continue; // Skip empty lines

              if (allCommented) {
                // Uncomment
                lines[i] = lines[i].replace(commentPattern, "$1");
              } else {
                // Comment
                const leadingWhitespace = lines[i].match(/^\s*/)?.[0] || "";
                lines[i] =
                  leadingWhitespace +
                  commentPrefix +
                  " " +
                  lines[i].substring(leadingWhitespace.length);
              }
            }

            const newValue = lines.join("\n");
            onChange(newValue);
            return;
          }

          // Cmd/Ctrl + Enter for new line below (like VS Code)
          if (cmdKey && e.key === "Enter") {
            e.preventDefault();
            const lines = currentValue.split("\n");
            const currentLine = currentValue.substring(0, selectionStart).split("\n").length - 1;
            const currentLineEnd =
              currentValue.substring(0, selectionStart).lastIndexOf("\n") +
              1 +
              lines[currentLine].length;

            const newValue =
              currentValue.substring(0, currentLineEnd) +
              "\n" +
              currentValue.substring(currentLineEnd);
            onChange(newValue);

            requestAnimationFrame(() => {
              if (textarea) {
                const newPos = currentLineEnd + 1;
                textarea.setSelectionRange(newPos, newPos);
              }
            });
            return;
          }

          // Cmd/Ctrl + Shift + Enter for new line above
          if (cmdKey && e.shiftKey && e.key === "Enter") {
            e.preventDefault();
            const currentLineStart =
              currentValue.substring(0, selectionStart).lastIndexOf("\n") + 1;

            const newValue =
              currentValue.substring(0, currentLineStart) +
              "\n" +
              currentValue.substring(currentLineStart);
            onChange(newValue);

            requestAnimationFrame(() => {
              if (textarea) {
                textarea.setSelectionRange(currentLineStart, currentLineStart);
              }
            });
            return;
          }

          // Cmd/Ctrl + Z for undo - let browser handle it
          if (cmdKey && e.key === "z" && !e.shiftKey) {
            // Don't prevent default - let the browser handle undo
            return;
          }

          // Cmd/Ctrl + Y or Cmd/Ctrl + Shift + Z for redo - let browser handle it
          if ((cmdKey && e.key === "y") || (cmdKey && e.shiftKey && e.key === "z")) {
            // Don't prevent default - let the browser handle redo
            return;
          }
        }

        // Handle vim mode if enabled
        if (vimEnabled && onKeyDown) {
          onKeyDown(e);
        }
      },
      [
        isLspCompletionVisible,
        lspCompletions,
        selectedLspIndex,
        applyLspCompletion,
        disabled,
        tabSize,
        onChange,
        language,
        vimEnabled,
        onKeyDown,
      ],
    );

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
              onKeyUp={handleCursorPositionChange}
              onClick={_e => {
                handleUserInteraction();
                handleCursorPositionChange();
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
        {hoverInfo && (
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
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <div className="p-4 overflow-auto scrollbar-hidden">
              {/* Check if content contains code blocks */}
              {hoverInfo.content.includes("```") ? (
                <div className="space-y-3">
                  {hoverInfo.content.split(/```[\w]*\n?/).map((part, index) => {
                    const trimmedPart = part.trim();
                    if (!trimmedPart) return null;

                    if (index % 2 === 1) {
                      // This is inside code blocks
                      return (
                        <pre
                          key={index}
                          className="font-mono text-sm bg-[var(--secondary-bg)] p-3 rounded-md border border-[var(--border-color)] text-[var(--text-color)] overflow-x-auto scrollbar-hidden"
                          style={{ fontSize: `${fontSize * 0.85}px` }}
                        >
                          {trimmedPart.replace(/```$/, "")}
                        </pre>
                      );
                    } else {
                      // This is markdown/plain text
                      return trimmedPart ? (
                        <div
                          key={index}
                          className="text-sm text-[var(--text-color)] leading-relaxed whitespace-pre-wrap"
                          style={{ fontSize: `${fontSize * 0.9}px` }}
                        >
                          {trimmedPart}
                        </div>
                      ) : null;
                    }
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
        )}
      </div>
    );
  },
);

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
