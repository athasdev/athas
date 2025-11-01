import { ChevronDown, Send, Square } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AIChatInputBarProps } from "@/features/ai/types/types";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/stores/ui-state-store";
import { getModelById } from "@/types/ai-provider";
import Button from "@/ui/button";
import { cn } from "@/utils/cn";
import { FileMentionDropdown } from "../mentions/file-mention-dropdown";
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

  // Local state for input emptiness check (to avoid subscribing to full input text)
  const [hasInputText, setHasInputText] = useState(false);

  // Get state from stores with optimized selectors
  const { settings } = useSettingsStore();
  const { openSettingsDialog } = useUIState();
  const { fontSize, fontFamily } = useEditorSettingsStore();

  // Get state from store - DO NOT subscribe to 'input' to avoid re-renders on every keystroke
  const isTyping = useAIChatStore((state) => state.isTyping);
  const streamingMessageId = useAIChatStore((state) => state.streamingMessageId);
  const selectedBufferIds = useAIChatStore((state) => state.selectedBufferIds);
  const selectedFilesPaths = useAIChatStore((state) => state.selectedFilesPaths);
  const isContextDropdownOpen = useAIChatStore((state) => state.isContextDropdownOpen);
  const isSendAnimating = useAIChatStore((state) => state.isSendAnimating);
  const queueCount = useAIChatStore((state) => state.messageQueue.length);
  const hasApiKey = useAIChatStore((state) => state.hasApiKey);
  const mentionState = useAIChatStore((state) => state.mentionState);

  // Memoize action selectors
  const setInput = useAIChatStore((state) => state.setInput);
  const setIsContextDropdownOpen = useAIChatStore((state) => state.setIsContextDropdownOpen);
  const setIsSendAnimating = useAIChatStore((state) => state.setIsSendAnimating);
  const toggleBufferSelection = useAIChatStore((state) => state.toggleBufferSelection);
  const toggleFileSelection = useAIChatStore((state) => state.toggleFileSelection);
  const showMention = useAIChatStore((state) => state.showMention);
  const hideMention = useAIChatStore((state) => state.hideMention);
  const updatePosition = useAIChatStore((state) => state.updatePosition);
  const selectNext = useAIChatStore((state) => state.selectNext);
  const selectPrevious = useAIChatStore((state) => state.selectPrevious);
  const getFilteredFiles = useAIChatStore((state) => state.getFilteredFiles);

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

  // Function to recalculate mention dropdown position
  const recalculateMentionPosition = useCallback(() => {
    if (!mentionState.active || !inputRef.current) return;

    const div = inputRef.current;
    const value = getPlainTextFromDiv();
    const selection = window.getSelection();
    const cursorPos = selection?.rangeCount ? selection.getRangeAt(0).startOffset : 0;
    const beforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = beforeCursor.lastIndexOf("@");

    if (lastAtIndex === -1) return;

    const divRect = div.getBoundingClientRect();
    const aiChatContainer = div.closest(".ai-chat-container");
    const containerRect = aiChatContainer?.getBoundingClientRect();

    const position = {
      top: divRect.bottom + 4, // Position below the input area
      left: containerRect ? containerRect.left : divRect.left, // Position at the left edge of the sidebar
    };

    updatePosition(position);
  }, [mentionState.active, updatePosition, getPlainTextFromDiv]);

  // ResizeObserver to track container size changes
  useEffect(() => {
    if (!aiChatContainerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      recalculateMentionPosition();
    });

    resizeObserver.observe(aiChatContainerRef.current);

    // Also observe the window resize
    const handleWindowResize = () => {
      recalculateMentionPosition();
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
  }, [recalculateMentionPosition]);

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

  // Click outside handler for context dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        contextDropdownRef.current &&
        !contextDropdownRef.current.contains(event.target as Node)
      ) {
        setIsContextDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setIsContextDropdownOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (mentionState.active) {
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
            const position = {
              top: inputRef.current.offsetTop + inputRef.current.offsetHeight + 4,
              left: inputRef.current.offsetLeft,
            };
            showMention(position, afterAt, lastAtIndex);
          } else {
            hideMention();
          }
        } else {
          hideMention();
        }
      }, 150); // Increased to 150ms for better performance
    },
    [showMention, hideMention],
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

      // Only do mention detection if text contains @ and is reasonably short
      if (plainTextFromDiv.includes("@") && plainTextFromDiv.length < 500) {
        debouncedMentionDetection(plainTextFromDiv);
      } else if (mentionState.active) {
        hideMention();
      }
    }
  }, [setInput, getPlainTextFromDiv, debouncedMentionDetection, hideMention, mentionState.active]);

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
          } catch (_e) {
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

  const handleSendMessage = async () => {
    const currentInput = useAIChatStore.getState().input;
    if (!currentInput.trim() || !hasApiKey) return;

    // Trigger send animation
    setIsSendAnimating(true);

    // Reset animation after the flying animation completes
    setTimeout(() => setIsSendAnimating(false), 800);

    // Send the message first
    await onSendMessage();

    // Clear input after message is sent
    setInput("");
    setHasInputText(false);
    if (inputRef.current) {
      inputRef.current.innerHTML = "";
    }
  };

  return (
    <div
      ref={aiChatContainerRef}
      className="ai-chat-container border-border border-t bg-terniary-bg"
    >
      <div className="px-2 py-1.5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <ContextSelector
              buffers={buffers}
              selectedBufferIds={selectedBufferIds}
              selectedFilesPaths={selectedFilesPaths}
              onToggleBuffer={toggleBufferSelection}
              onToggleFile={toggleFileSelection}
              isOpen={isContextDropdownOpen}
              onToggleOpen={() => setIsContextDropdownOpen(!isContextDropdownOpen)}
            />
          </div>
          <div
            ref={inputRef}
            contentEditable={hasApiKey}
            onInput={handleInputChange}
            onKeyDown={handleKeyDown}
            data-placeholder={
              hasApiKey
                ? "Enter your prompt ('@' tag files)"
                : "Configure API key to enable AI chat..."
            }
            className={cn(
              "max-h-[120px] min-h-[60px] w-full resize-none overflow-y-auto border-none bg-transparent",
              "p-1 text-text",
              "focus:outline-none",
              !hasApiKey ? "cursor-not-allowed opacity-50" : "cursor-text",
              // Custom styles for contentEditable placeholder
              "empty:before:pointer-events-none empty:before:text-text-lighter empty:before:content-[attr(data-placeholder)]",
            )}
            style={
              {
                // Use dynamic font settings (slightly smaller than editor for UI consistency)
                fontFamily: `${fontFamily}, "Fira Code", "Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace`,
                fontSize: `${Math.max(fontSize - 2, 11)}px`,
                // Ensure proper line height and text rendering
                lineHeight: "1.4",
                wordWrap: "break-word",
                overflowWrap: "break-word",
              } as React.CSSProperties
            }
            role="textbox"
            aria-multiline="true"
            aria-label="Message input"
            tabIndex={hasApiKey ? 0 : -1}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* Queue indicator */}
            {queueCount > 0 && (
              <div className="flex items-center gap-1 rounded bg-blue-500/10 px-2 py-1 text-blue-400 text-xs">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                <span>{queueCount} queued</span>
              </div>
            )}
          </div>
          <div className="flex select-none items-center gap-1">
            {/* Model selector button */}
            <button
              onClick={() => openSettingsDialog("ai")}
              className="flex items-center gap-1 rounded bg-transparent px-2 py-1 font-mono text-xs transition-colors hover:bg-hover"
              title="Open AI settings to change model"
            >
              <div className="truncate text-text-lighter text-xs">
                {getModelById(settings.aiProviderId, settings.aiModelId)?.name ||
                  "Claude Code Local"}
              </div>
              <ChevronDown size={12} className="text-text-lighter" />
            </button>
            <Button
              type="submit"
              disabled={!hasInputText || !hasApiKey}
              onClick={isTyping && streamingMessageId ? onStopStreaming : handleSendMessage}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded p-0 text-text-lighter hover:bg-hover hover:text-text",
                "send-button-hover button-transition focus:outline-none focus:ring-2 focus:ring-accent/50",
                isTyping && streamingMessageId && !isSendAnimating && "button-morphing",
                hasInputText &&
                  hasApiKey &&
                  "bg-blue-500 text-white hover:bg-blue-600 focus:ring-blue-500/50",
                !hasInputText || !hasApiKey ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              )}
              title={
                isTyping && streamingMessageId
                  ? "Stop generation (Escape)"
                  : queueCount > 0
                    ? "Add to queue (Enter)"
                    : "Send message (Enter)"
              }
              aria-label={isTyping && streamingMessageId ? "Stop generation" : "Send message"}
              tabIndex={0}
            >
              {isTyping && streamingMessageId && !isSendAnimating ? (
                <Square size={14} className="transition-all duration-300" />
              ) : (
                <Send
                  size={14}
                  className={cn(
                    "send-icon transition-all duration-200",
                    isSendAnimating && "flying",
                  )}
                />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* File Mention Dropdown */}
      {mentionState.active && <FileMentionDropdown onSelect={handleFileMentionSelect} />}
    </div>
  );
});

export default AIChatInputBar;
