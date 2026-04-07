import { Mic, Slash, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shouldIgnoreFile } from "@/features/quick-open/utils/file-filtering";
import { controlFieldSizeVariants, controlFieldSurfaceVariants } from "@/ui/control-field";
import { getPrimarySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import { useAIChatStore } from "@/features/ai/store/store";
import type { InlineDropdownPosition } from "@/features/ai/store/types";
import type { SlashCommand } from "@/features/ai/types/acp";
import type { AIChatInputBarProps } from "@/features/ai/types/ai-chat";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import { isMac } from "@/utils/platform";
import { FileMentionDropdown } from "../mentions/file-mention-dropdown";
import { SlashCommandDropdown } from "../mentions/slash-command-dropdown";
import { AcpConfigSelector } from "../selectors/acp-config-selector";
import { ModeSelector } from "../selectors/mode-selector";
import { ContextSelector } from "../selectors/context-selector";

const AIChatInputBar = memo(function AIChatInputBar({
  buffers,
  allProjectFiles,
  onSendMessage,
  onStopStreaming,
}: AIChatInputBarProps) {
  const inputRef = useRef<HTMLDivElement>(null);
  const contextDropdownRef = useRef<HTMLDivElement>(null);
  const aiChatContainerRef = useRef<HTMLDivElement>(null);
  const isUpdatingContentRef = useRef(false);
  const performanceTimer = useRef<number | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldKeepListeningRef = useRef(false);

  // Local state for input emptiness check (to avoid subscribing to full input text)
  const [hasInputText, setHasInputText] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [activeInlineControl, setActiveInlineControl] = useState<
    "model" | "mode" | "commands" | null
  >(null);

  // Get state from stores with optimized selectors
  const { fontSize, fontFamily } = useEditorSettingsStore();

  // Get state from store - DO NOT subscribe to 'input' to avoid re-renders on every keystroke
  const isTyping = useAIChatStore((state) => state.isTyping);
  const streamingMessageId = useAIChatStore((state) => state.streamingMessageId);
  const selectedBufferIds = useAIChatStore((state) => state.selectedBufferIds);
  const selectedFilesPaths = useAIChatStore((state) => state.selectedFilesPaths);
  const isContextDropdownOpen = useAIChatStore((state) => state.isContextDropdownOpen);
  const queueCount = useAIChatStore((state) => state.messageQueue.length);
  const hasApiKey = useAIChatStore((state) => state.hasApiKey);
  const mentionState = useAIChatStore((state) => state.mentionState);
  const getCurrentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
  const sessionConfigOptions = useAIChatStore((state) => state.sessionConfigOptions);

  // Check if current agent is "custom" (only show model selector for custom agent)
  const currentAgentId = getCurrentAgentId();
  const isCustomAgent = currentAgentId === "custom";

  // ACP agents don't need API key (they handle their own auth)
  const isInputEnabled = isCustomAgent ? hasApiKey : true;
  const isStreaming = isTyping && !!streamingMessageId;
  const acpModelOption = useMemo(
    () => (isCustomAgent ? null : getPrimarySessionConfigOption(sessionConfigOptions, "model")),
    [isCustomAgent, sessionConfigOptions],
  );

  // Memoize action selectors
  const setInput = useAIChatStore((state) => state.setInput);
  const setIsContextDropdownOpen = useAIChatStore((state) => state.setIsContextDropdownOpen);
  const toggleBufferSelection = useAIChatStore((state) => state.toggleBufferSelection);
  const toggleFileSelection = useAIChatStore((state) => state.toggleFileSelection);
  const showMention = useAIChatStore((state) => state.showMention);
  const hideMention = useAIChatStore((state) => state.hideMention);
  const updatePosition = useAIChatStore((state) => state.updatePosition);
  const selectNext = useAIChatStore((state) => state.selectNext);
  const selectPrevious = useAIChatStore((state) => state.selectPrevious);
  const getFilteredFiles = useAIChatStore((state) => state.getFilteredFiles);

  // Slash command state and actions
  const slashCommandState = useAIChatStore((state) => state.slashCommandState);
  const showSlashCommands = useAIChatStore((state) => state.showSlashCommands);
  const hideSlashCommands = useAIChatStore((state) => state.hideSlashCommands);
  const selectNextSlashCommand = useAIChatStore((state) => state.selectNextSlashCommand);
  const selectPreviousSlashCommand = useAIChatStore((state) => state.selectPreviousSlashCommand);
  const getFilteredSlashCommands = useAIChatStore((state) => state.getFilteredSlashCommands);
  const changeSessionConfigOption = useAIChatStore((state) => state.changeSessionConfigOption);

  // Pasted images state and actions
  const pastedImages = useAIChatStore((state) => state.pastedImages);
  const addPastedImage = useAIChatStore((state) => state.addPastedImage);
  const removePastedImage = useAIChatStore((state) => state.removePastedImage);
  const clearPastedImages = useAIChatStore((state) => state.clearPastedImages);

  const closeInlineMenus = useCallback(() => {
    setActiveInlineControl(null);
    if (slashCommandState.active) {
      hideSlashCommands();
    }
    if (isContextDropdownOpen) {
      setIsContextDropdownOpen(false);
    }
    if (mentionState.active) {
      hideMention();
    }
  }, [
    slashCommandState.active,
    hideSlashCommands,
    isContextDropdownOpen,
    setIsContextDropdownOpen,
    mentionState.active,
    hideMention,
  ]);

  // Computed state for send button
  const hasImages = pastedImages.length > 0;
  const isSendDisabled = isStreaming ? false : (!hasInputText && !hasImages) || !isInputEnabled;
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isMacDevSpeechRecognitionBlocked = import.meta.env.DEV && isMac();
  const isSpeechRecognitionSupported =
    !isMacDevSpeechRecognitionBlocked && typeof SpeechRecognitionCtor !== "undefined";

  // Highly optimized function to get plain text from contentEditable div
  const getPlainTextFromDiv = useCallback(() => {
    if (!inputRef.current) return "";

    const element = inputRef.current;
    const children = element.childNodes;

    // Fast path: check if there are any mention badges (without Array.from for performance)
    let hasMentions = false;
    for (let i = 0; i < children.length; i++) {
      if (
        children[i].nodeType === Node.ELEMENT_NODE &&
        (children[i] as Element).hasAttribute("data-mention")
      ) {
        hasMentions = true;
        break;
      }
    }

    // If no mentions, just return textContent (fastest path)
    if (!hasMentions) {
      return element.textContent || "";
    }

    // Handle mention badges
    let text = "";
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || "";
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (el.hasAttribute("data-mention")) {
          const fileName = el.textContent?.trim();
          if (fileName) text += `@[${fileName}]`;
        } else {
          text += node.textContent || "";
        }
      }
    }

    return text;
  }, []);

  const getMentionDropdownPosition = useCallback(() => {
    if (!inputRef.current) {
      return { top: 0, bottom: 0, left: 0, width: 0 };
    }

    const inputRect = inputRef.current.getBoundingClientRect();
    const horizontalInset = 8;

    const position: InlineDropdownPosition = {
      top: inputRect.top,
      bottom: inputRect.bottom,
      left: inputRect.left + horizontalInset,
      width: Math.max(inputRect.width - horizontalInset * 2, 220),
    };

    return position;
  }, []);

  // Function to recalculate mention dropdown position
  const recalculateMentionPosition = useCallback(() => {
    if (!mentionState.active) return;
    updatePosition(getMentionDropdownPosition());
  }, [mentionState.active, updatePosition, getMentionDropdownPosition]);

  const getSlashDropdownPosition = useCallback(() => {
    if (!inputRef.current) {
      return { top: 0, bottom: 0, left: 0, width: 0 };
    }

    const inputRect = inputRef.current.getBoundingClientRect();
    const horizontalInset = 8;

    const position: InlineDropdownPosition = {
      top: inputRect.top,
      bottom: inputRect.bottom,
      left: inputRect.left + horizontalInset,
      width: Math.max(inputRect.width - horizontalInset * 2, 220),
    };

    return position;
  }, []);

  const mentionableFiles = useMemo(
    () => allProjectFiles.filter((file) => !file.isDir && !shouldIgnoreFile(file.path)),
    [allProjectFiles],
  );

  // ResizeObserver to track container size changes
  useEffect(() => {
    if (!aiChatContainerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      recalculateMentionPosition();
      if (slashCommandState.active) {
        showSlashCommands(getSlashDropdownPosition(), slashCommandState.search);
      }
    });

    resizeObserver.observe(aiChatContainerRef.current);

    // Also observe the window resize
    const handleWindowResize = () => {
      recalculateMentionPosition();
      if (slashCommandState.active) {
        showSlashCommands(getSlashDropdownPosition(), slashCommandState.search);
      }
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      // Cleanup timers
      if (performanceTimer.current) {
        clearTimeout(performanceTimer.current);
      }
    };
  }, [
    recalculateMentionPosition,
    slashCommandState.active,
    slashCommandState.search,
    showSlashCommands,
    getSlashDropdownPosition,
  ]);

  // Sync contentEditable div with input state when it changes externally (e.g., when switching chats)
  // We use a ref to track the last synced input to avoid subscribing to every keystroke
  const lastSyncedInputRef = useRef("");

  useEffect(() => {
    // Only sync when input changes externally (not from user typing)
    const checkAndSync = () => {
      if (!inputRef.current || isUpdatingContentRef.current) return;

      const storeInput = useAIChatStore.getState().input;
      const currentContent = getPlainTextFromDiv();

      // Only sync if store input differs from what's in the DOM and it's an external change
      if (storeInput !== currentContent && storeInput !== lastSyncedInputRef.current) {
        isUpdatingContentRef.current = true;
        lastSyncedInputRef.current = storeInput;

        // Update contentEditable content
        if (storeInput === "") {
          inputRef.current.innerHTML = "";
        } else {
          inputRef.current.textContent = storeInput;
        }

        // Position cursor at the end
        setTimeout(() => {
          if (inputRef.current) {
            const selection = window.getSelection();
            if (selection) {
              const range = document.createRange();
              range.selectNodeContents(inputRef.current);
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
            }
            inputRef.current.focus();
          }
          isUpdatingContentRef.current = false;
        }, 0);
      }
    };

    // Check on mount and when component updates
    checkAndSync();

    // Note: We don't subscribe to continuous changes to avoid re-renders
    // The checkAndSync on mount handles initial sync and chat switching
  }, [getPlainTextFromDiv]);

  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = false;
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Handle slash command navigation
    if (slashCommandState.active) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectNextSlashCommand();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectPreviousSlashCommand();
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const filteredCommands = getFilteredSlashCommands();
        if (filteredCommands[slashCommandState.selectedIndex]) {
          handleSlashCommandSelect(filteredCommands[slashCommandState.selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideSlashCommands();
      }
    } else if (mentionState.active) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectNext();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectPrevious();
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        // Handle file selection
        const filteredFiles = getFilteredFiles(allProjectFiles);
        if (filteredFiles[mentionState.selectedIndex]) {
          handleFileMentionSelect(filteredFiles[mentionState.selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideMention();
      }
    } else if (e.key === "Backspace") {
      // Handle mention badge deletion
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && inputRef.current) {
        const range = selection.getRangeAt(0);
        const container = range.startContainer;
        const offset = range.startOffset;

        // Check if cursor is at the beginning of a text node that follows a mention badge
        if (container.nodeType === Node.TEXT_NODE && offset === 0) {
          const previousSibling = container.previousSibling;

          if (
            previousSibling &&
            previousSibling.nodeType === Node.ELEMENT_NODE &&
            (previousSibling as Element).hasAttribute("data-mention")
          ) {
            e.preventDefault();

            // Remove the mention badge
            previousSibling.remove();

            // Update the input state by getting the new plain text
            const newPlainText = getPlainTextFromDiv();
            setInput(newPlainText);

            return;
          }
        }

        // Check if cursor is right after a mention badge (in separator text node)
        if (
          container.nodeType === Node.TEXT_NODE &&
          container.textContent === "\u200B" &&
          offset === 1
        ) {
          const previousSibling = container.previousSibling?.previousSibling; // Skip the space node

          if (
            previousSibling &&
            previousSibling.nodeType === Node.ELEMENT_NODE &&
            (previousSibling as Element).hasAttribute("data-mention")
          ) {
            e.preventDefault();

            // Remove the mention badge
            previousSibling.remove();

            // Update the input state
            const newPlainText = getPlainTextFromDiv();
            setInput(newPlainText);

            return;
          }
        }
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Debounced mention detection - increased delay for better performance
  const debouncedMentionDetection = useCallback(
    (plainText: string) => {
      if (performanceTimer.current) {
        clearTimeout(performanceTimer.current);
      }

      performanceTimer.current = window.setTimeout(() => {
        if (!inputRef.current) return;

        const lastAtIndex = plainText.lastIndexOf("@");

        if (lastAtIndex !== -1) {
          const afterAt = plainText.slice(lastAtIndex + 1);
          // Check if there's no space between @ and end, and it's not part of a mention badge
          if (!afterAt.includes(" ") && !afterAt.includes("]") && afterAt.length < 50) {
            const position = getMentionDropdownPosition();
            showMention(position, afterAt, lastAtIndex);
          } else {
            hideMention();
          }
        } else {
          hideMention();
        }
      }, 150); // Increased to 150ms for better performance
    },
    [showMention, hideMention, getMentionDropdownPosition],
  );

  // Optimized input change handler - no throttle for immediate response
  const handleInputChange = useCallback(() => {
    if (!inputRef.current || isUpdatingContentRef.current) return;

    const plainTextFromDiv = getPlainTextFromDiv();

    // Use store's getState to avoid dependency on input prop
    const currentInput = useAIChatStore.getState().input;

    // Only update if content actually changed
    if (plainTextFromDiv !== currentInput) {
      setInput(plainTextFromDiv);

      // Update local state for button enabled/disabled
      setHasInputText(plainTextFromDiv.trim().length > 0);

      // Detect slash commands at start of input (robust against leading whitespace/newlines)
      const normalizedInput = plainTextFromDiv.trimStart();
      if (normalizedInput.startsWith("/")) {
        const slashToken = normalizedInput.slice(1);
        const hasWhitespaceAfterSlash = /\s/.test(slashToken);
        const search = hasWhitespaceAfterSlash ? slashToken.split(/\s+/)[0] : slashToken;

        if (!hasWhitespaceAfterSlash && search.length < 50) {
          setActiveInlineControl("commands");
          if (isContextDropdownOpen) {
            setIsContextDropdownOpen(false);
          }
          showSlashCommands(getSlashDropdownPosition(), search);
        } else {
          setActiveInlineControl(null);
          hideSlashCommands();
        }
      } else if (slashCommandState.active) {
        setActiveInlineControl(null);
        hideSlashCommands();
      }

      // Only do mention detection if text contains @ and is reasonably short
      if (plainTextFromDiv.includes("@") && plainTextFromDiv.length < 500) {
        debouncedMentionDetection(plainTextFromDiv);
      } else if (mentionState.active) {
        hideMention();
      }
    }
  }, [
    setInput,
    getPlainTextFromDiv,
    debouncedMentionDetection,
    hideMention,
    mentionState.active,
    showSlashCommands,
    hideSlashCommands,
    slashCommandState.active,
    getSlashDropdownPosition,
    isContextDropdownOpen,
    setIsContextDropdownOpen,
  ]);

  const insertTextAtCursor = useCallback(
    (text: string) => {
      if (!inputRef.current || !text) return;

      const normalizedText = text.replace(/\s+/g, " ").trim();
      if (!normalizedText) return;

      const selection = window.getSelection();
      const range = document.createRange();
      const currentText = getPlainTextFromDiv();
      const prefix = currentText.trim().length > 0 && !/\s$/.test(currentText) ? " " : "";
      const textNode = document.createTextNode(`${prefix}${normalizedText} `);

      inputRef.current.focus();

      const selectionInsideInput =
        !!selection && selection.rangeCount > 0 && inputRef.current.contains(selection.anchorNode);

      if (selectionInsideInput && selection) {
        const selectedRange = selection.getRangeAt(0);
        selectedRange.deleteContents();
        selectedRange.insertNode(textNode);
        range.setStartAfter(textNode);
      } else {
        range.selectNodeContents(inputRef.current);
        range.collapse(false);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
      }

      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      handleInputChange();
    },
    [getPlainTextFromDiv, handleInputChange],
  );

  // Handle paste - strip HTML formatting, keep only plain text. Images are added to preview.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      // Check for images first
      const items = clipboardData.items;
      let hasImage = false;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          hasImage = true;
          e.preventDefault();

          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
              const dataUrl = event.target?.result as string;
              if (dataUrl) {
                addPastedImage({
                  id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                  dataUrl,
                  name: file.name || `image-${Date.now()}.png`,
                  size: file.size,
                });
              }
            };
            reader.readAsDataURL(file);
          }
        }
      }

      // If there was an image, don't process text
      if (hasImage) return;

      // For text content, prevent default and insert plain text only
      e.preventDefault();

      // Get plain text from clipboard
      const plainText = clipboardData.getData("text/plain");
      if (!plainText) return;

      // Insert plain text at cursor position
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      range.deleteContents();

      const textNode = document.createTextNode(plainText);
      range.insertNode(textNode);

      // Move cursor to end of inserted text
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);

      // Trigger input change handler to update state
      handleInputChange();
    },
    [handleInputChange, addPastedImage],
  );

  // Handle file mention selection
  const handleFileMentionSelect = useCallback(
    (file: any) => {
      if (!inputRef.current) return;

      isUpdatingContentRef.current = true;

      const currentInput = useAIChatStore.getState().input;
      const beforeMention = currentInput.slice(0, mentionState.startIndex);
      const afterMention = currentInput.slice(
        mentionState.startIndex + mentionState.search.length + 1,
      );
      const newInput = `${beforeMention}@[${file.name}] ${afterMention}`;

      // Update input state and hide mention dropdown
      setInput(newInput);
      hideMention();

      // Completely rebuild the DOM content to ensure clean structure
      setTimeout(() => {
        if (!inputRef.current) return;

        // Clear all content
        inputRef.current.innerHTML = "";

        // Build new content piece by piece
        // Add text before mention if any
        if (beforeMention) {
          const beforeTextNode = document.createTextNode(beforeMention);
          inputRef.current.appendChild(beforeTextNode);
        }

        // Add the mention badge
        const mentionSpan = document.createElement("span");
        mentionSpan.setAttribute("data-mention", "true");
        mentionSpan.className =
          "inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-blue-400 select-none";
        mentionSpan.style.fontFamily = `${fontFamily}, "Fira Code", "Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace`;
        mentionSpan.style.fontSize = `${Math.max(fontSize - 4, 10)}px`; // Smaller than input text
        mentionSpan.textContent = file.name;
        inputRef.current.appendChild(mentionSpan);

        // Always add a space and remaining text as separate text node
        // Ensure there's always substantial content to prevent cursor from jumping to span
        const remainingText = ` ${afterMention}${afterMention ? "" : " "}`;
        const afterTextNode = document.createTextNode(remainingText);
        inputRef.current.appendChild(afterTextNode);

        // Add an invisible zero-width space to ensure cursor stays in text node
        const separatorNode = document.createTextNode("\u200B"); // Zero-width space
        inputRef.current.appendChild(separatorNode);

        // Position cursor in the separator node to ensure it doesn't jump to span
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          try {
            // Position at the end of the separator node
            range.setStart(separatorNode, 1);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          } catch {
            // Fallback - position at end of input
            range.selectNodeContents(inputRef.current);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }

        inputRef.current.focus();
        isUpdatingContentRef.current = false;
      }, 0);
    },
    [
      mentionState.startIndex,
      mentionState.search.length,
      setInput,
      hideMention,
      fontFamily,
      fontSize,
    ],
  );

  // Handle slash command selection
  const handleSlashCommandSelect = useCallback(
    (command: SlashCommand) => {
      if (!inputRef.current) return;

      isUpdatingContentRef.current = true;

      // Replace the current input with the slash command
      const newInput = `/${command.name} `;
      setInput(newInput);
      hideSlashCommands();

      // Update the DOM content
      setTimeout(() => {
        if (!inputRef.current) return;

        inputRef.current.textContent = newInput;

        // Position cursor at the end
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(inputRef.current);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }

        inputRef.current.focus();
        isUpdatingContentRef.current = false;
      }, 0);
    },
    [setInput, hideSlashCommands],
  );

  const handleSendMessage = async () => {
    const currentInput = useAIChatStore.getState().input;
    const currentImages = useAIChatStore.getState().pastedImages;
    const hasContent = currentInput.trim() || currentImages.length > 0;
    if (!hasContent || !isInputEnabled) return;

    // Clear input and images immediately after send is triggered
    setInput("");
    setHasInputText(false);
    clearPastedImages();
    if (inputRef.current) {
      inputRef.current.innerHTML = "";
    }

    // Send the captured message (TODO: include images in message)
    await onSendMessage(currentInput);
  };

  const stopVoiceInput = useCallback(() => {
    shouldKeepListeningRef.current = false;
    speechRecognitionRef.current?.stop();
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  const startVoiceInput = useCallback(() => {
    if (!isInputEnabled) return;

    if (isMacDevSpeechRecognitionBlocked) {
      toast.warning("Voice input is disabled in macOS dev mode. Test it in a packaged app build.");
      return;
    }

    if (!SpeechRecognitionCtor) {
      toast.warning("Voice input is not supported in this webview.");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    speechRecognitionRef.current = recognition;
    shouldKeepListeningRef.current = true;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      let committedTranscript = "";
      let nextInterimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript?.trim();
        if (!transcript) continue;

        if (event.results[i].isFinal) {
          committedTranscript += `${transcript} `;
        } else {
          nextInterimTranscript = transcript;
        }
      }

      if (committedTranscript.trim()) {
        insertTextAtCursor(committedTranscript);
      }

      setInterimTranscript(nextInterimTranscript);
    };

    recognition.onerror = (event) => {
      const isExpectedAbort = event.error === "aborted" || event.error === "no-speech";
      setIsListening(false);
      setInterimTranscript("");

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldKeepListeningRef.current = false;
        toast.error(
          "Microphone access failed. Check System Settings → Privacy & Security → Microphone.",
        );
        return;
      }

      if (!isExpectedAbort) {
        shouldKeepListeningRef.current = false;
        toast.error("Voice input stopped unexpectedly.");
      }
    };

    recognition.onend = () => {
      if (shouldKeepListeningRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          shouldKeepListeningRef.current = false;
        }
      }

      setIsListening(false);
      setInterimTranscript("");
      speechRecognitionRef.current = null;
    };

    try {
      recognition.start();
      setIsListening(true);
      setInterimTranscript("");
      inputRef.current?.focus();
    } catch {
      shouldKeepListeningRef.current = false;
      speechRecognitionRef.current = null;
      toast.error("Voice input could not be started.");
    }
  }, [SpeechRecognitionCtor, insertTextAtCursor, isInputEnabled, isMacDevSpeechRecognitionBlocked]);

  const toggleVoiceInput = useCallback(() => {
    if (isListening) {
      stopVoiceInput();
      return;
    }

    startVoiceInput();
  }, [isListening, startVoiceInput, stopVoiceInput]);

  // Get available slash commands
  const availableSlashCommands = useAIChatStore((state) => state.availableSlashCommands);
  const hasSlashCommands = availableSlashCommands.length > 0;
  const hasAttachedComposerDropdown = mentionState.active || slashCommandState.active;

  return (
    <div
      ref={aiChatContainerRef}
      className="ai-chat-container relative z-20 bg-transparent px-3 pt-2 pb-3"
    >
      <div
        className={cn(
          "overflow-hidden border bg-primary-bg/55 transition-[border-radius,border-color,box-shadow]",
          hasAttachedComposerDropdown
            ? "rounded-t-xl rounded-b-2xl border-border/70 shadow-[0_14px_32px_-26px_rgba(0,0,0,0.5)]"
            : "rounded-lg border-border/60",
        )}
      >
        {pastedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 pt-2">
            {pastedImages.map((image) => (
              <div
                key={image.id}
                className="group relative overflow-hidden rounded border border-border bg-secondary-bg"
              >
                <img
                  src={image.dataUrl}
                  alt={image.name}
                  className="h-16 w-auto max-w-[120px] object-cover"
                />
                <Button
                  onClick={() => removePastedImage(image.id)}
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-0.5 right-0.5 rounded-full bg-black/60 text-white opacity-0 hover:bg-black/80 group-hover:opacity-100"
                  aria-label="Remove image"
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div
          ref={inputRef}
          contentEditable={isInputEnabled}
          onInput={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          data-placeholder={
            isInputEnabled
              ? hasSlashCommands
                ? "Message... (@ files, / commands)"
                : "Message... (@ to mention files)"
              : "Configure API key to enable AI chat..."
          }
          className={cn(
            "max-h-[140px] min-h-[64px] w-full resize-none overflow-x-hidden overflow-y-auto bg-transparent",
            "ui-font px-2 py-1.5 text-inherit text-text placeholder:text-text-lighter",
            "focus:outline-none",
            hasAttachedComposerDropdown && "border-border/40 border-t",
            !isInputEnabled ? "cursor-not-allowed opacity-50" : "cursor-text",
            "empty:before:pointer-events-none empty:before:text-text-lighter empty:before:content-[attr(data-placeholder)]",
          )}
          style={
            {
              fontFamily: `${fontFamily}, "Fira Code", "Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace`,
              fontSize: `${Math.max(fontSize - 2, 11)}px`,
              lineHeight: "1.4",
              wordWrap: "break-word",
              overflowWrap: "break-word",
            } as React.CSSProperties
          }
          role="textbox"
          aria-multiline="true"
          aria-label="Message input"
          tabIndex={isInputEnabled ? 0 : -1}
        />

        <div className="flex items-center justify-between px-2 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div ref={contextDropdownRef} className="min-w-0 flex-1">
              <ContextSelector
                buffers={buffers}
                selectedBufferIds={selectedBufferIds}
                selectedFilesPaths={selectedFilesPaths}
                onToggleBuffer={toggleBufferSelection}
                onToggleFile={toggleFileSelection}
                isOpen={isContextDropdownOpen}
                onToggleOpen={() => {
                  if (!isContextDropdownOpen) {
                    closeInlineMenus();
                  }
                  setIsContextDropdownOpen(!isContextDropdownOpen);
                }}
              />
            </div>

            {queueCount > 0 && (
              <Badge
                shape="pill"
                size="sm"
                className="gap-1 border border-blue-500/30 bg-blue-500/10 px-2.5 text-blue-400"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                <span>{queueCount}</span>
              </Badge>
            )}

            {isListening && (
              <Badge
                shape="pill"
                size="sm"
                className="gap-1 border border-blue-500/30 bg-blue-500/10 px-2.5 text-blue-400"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                <span className="max-w-[120px] truncate">
                  {interimTranscript ? interimTranscript : "Listening..."}
                </span>
              </Badge>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {acpModelOption && (
              <AcpConfigSelector
                option={acpModelOption}
                onChange={(value) => void changeSessionConfigOption(acpModelOption.id, value)}
                open={activeInlineControl === "model"}
                onOpenChange={(open) => {
                  if (open) {
                    closeInlineMenus();
                    setActiveInlineControl("model");
                    return;
                  }
                  setActiveInlineControl((current) => (current === "model" ? null : current));
                }}
                className="w-fit max-w-[180px]"
                menuClassName="w-[min(280px,calc(100vw-16px))]"
              />
            )}

            <ModeSelector
              open={activeInlineControl === "mode"}
              onOpenChange={(open) => {
                if (open) {
                  closeInlineMenus();
                  setActiveInlineControl("mode");
                  return;
                }
                setActiveInlineControl((current) => (current === "mode" ? null : current));
              }}
            />

            {hasSlashCommands && (
              <Button
                onClick={() => {
                  if (inputRef.current && isInputEnabled) {
                    if (slashCommandState.active) {
                      setActiveInlineControl(null);
                      hideSlashCommands();
                      return;
                    }
                    closeInlineMenus();
                    inputRef.current.textContent = "/";
                    setInput("/");
                    setHasInputText(true);
                    inputRef.current.focus();
                    setActiveInlineControl("commands");
                    showSlashCommands(getSlashDropdownPosition(), "");
                  }
                }}
                variant="secondary"
                size="xs"
                className={cn(
                  controlFieldSurfaceVariants({ variant: "secondary" }),
                  controlFieldSizeVariants({ size: "xs" }),
                  "w-fit gap-0 px-1.5 text-text-lighter hover:text-text",
                  slashCommandState.active && "border-border-strong bg-hover text-text",
                )}
                title="Show slash commands"
                aria-label="Show slash commands"
              >
                <Slash size={12} />
              </Button>
            )}

            <Button
              type="button"
              disabled={!isInputEnabled || !isSpeechRecognitionSupported}
              onClick={toggleVoiceInput}
              variant="secondary"
              size="xs"
              className={cn(
                controlFieldSurfaceVariants({ variant: "secondary" }),
                controlFieldSizeVariants({ size: "xs" }),
                "w-fit gap-1 px-1.5 text-text-lighter hover:text-text",
                isListening && "border-blue-500/30 bg-blue-500/10 text-blue-400",
              )}
              title={
                isMacDevSpeechRecognitionBlocked
                  ? "Voice input is disabled in macOS dev mode"
                  : !isSpeechRecognitionSupported
                    ? "Voice input is not supported"
                    : isListening
                      ? "Stop voice input"
                      : "Start voice input"
              }
              aria-label={isListening ? "Stop voice input" : "Start voice input"}
              aria-pressed={isListening}
            >
              <Mic size={12} className={cn(isListening && "animate-pulse")} />
            </Button>

            <Button
              type="button"
              disabled={isSendDisabled}
              onClick={isStreaming ? onStopStreaming : handleSendMessage}
              variant="ghost"
              size="xs"
              className={cn(
                "ui-font",
                isSendDisabled
                  ? "cursor-not-allowed text-text-lighter opacity-50"
                  : (hasInputText || hasImages) && isInputEnabled
                    ? "text-accent hover:text-accent/80"
                    : "text-text-lighter hover:text-text",
              )}
              title={
                isStreaming
                  ? "Stop generation (Escape)"
                  : queueCount > 0
                    ? "Add to queue (Enter)"
                    : "Send message (Enter)"
              }
              aria-label={isStreaming ? "Stop generation" : "Send message"}
            >
              {isStreaming ? "Stop" : "Send"}
            </Button>
          </div>
        </div>
      </div>

      {mentionState.active && (
        <FileMentionDropdown files={mentionableFiles} onSelect={handleFileMentionSelect} />
      )}

      {slashCommandState.active && <SlashCommandDropdown onSelect={handleSlashCommandSelect} />}
    </div>
  );
});

export default AIChatInputBar;
