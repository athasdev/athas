import { AlertCircle, LoaderCircle, Send, Slash, Square, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useChatActions, useChatState } from "@/features/ai/hooks/use-chat-store";
import {
  getHarnessComposerSeedCharacter,
  shouldSeedHarnessComposerKeyEvent,
} from "@/features/ai/lib/harness-composer-seed";
import { useAIChatStore } from "@/features/ai/store/store";
import type { SlashCommand } from "@/features/ai/types/acp";
import type { AIChatInputBarProps } from "@/features/ai/types/ai-chat";
import type { HarnessTrustState } from "@/features/ai/types/chat-ui";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import Button from "@/ui/button";
import { cn } from "@/utils/cn";
import { FileMentionDropdown } from "../mentions/file-mention-dropdown";
import { SlashCommandDropdown } from "../mentions/slash-command-dropdown";
import { ChatModeSelector } from "../selectors/chat-mode-selector";
import { ContextSelector } from "../selectors/context-selector";
import { PiNativeRuntimeControls } from "../selectors/pi-native-runtime-controls";
import { UnifiedAgentSelector } from "../selectors/unified-agent-selector";

const getHarnessStatusTone = (status: HarnessTrustState) => {
  switch (status.kind) {
    case "running":
      return {
        dotClassName: "bg-blue-400",
        textClassName: "text-blue-200",
        Icon: LoaderCircle,
      };
    case "attention":
      return {
        dotClassName: "bg-yellow-400",
        textClassName: "text-yellow-200",
        Icon: AlertCircle,
      };
    case "error":
      return {
        dotClassName: "bg-red-400",
        textClassName: "text-red-200",
        Icon: AlertCircle,
      };
    default:
      return {
        dotClassName: "bg-text-lighter/35",
        textClassName: "text-text-lighter",
        Icon: null,
      };
  }
};

const AIChatInputBar = memo(function AIChatInputBar({
  buffers,
  allProjectFiles,
  surface = "panel",
  scopeId,
  harnessStatus,
  runtimeBackend = "legacy-acp-bridge",
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
  const { fontSize, fontFamily } = useEditorSettingsStore();
  const chatState = useChatState(scopeId);
  const chatActions = useChatActions(scopeId);
  const currentChat = chatState.chats.find((chat) => chat.id === chatState.currentChatId);
  const currentRuntimeState = currentChat?.acpState?.runtimeState ?? null;

  // Get state from store - DO NOT subscribe to 'input' to avoid re-renders on every keystroke
  const hasApiKey = useAIChatStore((state) => state.hasApiKey);
  const mentionState = useAIChatStore((state) => state.mentionState);

  // Check if current agent is "custom" (only show model selector for custom agent)
  const currentAgentId = chatActions.getCurrentAgentId();
  const isCustomAgent = currentAgentId === "custom";

  // ACP agents don't need API key (they handle their own auth)
  const isInputEnabled = isCustomAgent ? hasApiKey : true;
  const isStreaming = chatState.isTyping && !!chatState.streamingMessageId;

  // Memoize action selectors
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

  // Pasted images state and actions
  // Computed state for send button
  const hasImages = chatState.pastedImages.length > 0;
  const isSendDisabled = isStreaming ? false : (!hasInputText && !hasImages) || !isInputEnabled;

  useEffect(() => {
    if (surface !== "harness" || !isInputEnabled || !inputRef.current) {
      return;
    }

    const focusComposer = () => {
      if (!inputRef.current?.isConnected) {
        return;
      }

      inputRef.current.focus();

      const selection = window.getSelection();
      if (!selection) {
        return;
      }

      const range = document.createRange();
      range.selectNodeContents(inputRef.current);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    };

    const timer = window.setTimeout(focusComposer, 0);
    return () => window.clearTimeout(timer);
  }, [surface, isInputEnabled, chatState.currentChatId]);

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

  const syncDraftInput = useCallback(
    (nextInput: string, { focusComposer = false }: { focusComposer?: boolean } = {}) => {
      chatActions.setInput(nextInput);
      lastSyncedInputRef.current = nextInput;
      setHasInputText(nextInput.trim().length > 0);

      if (focusComposer && inputRef.current) {
        inputRef.current.textContent = nextInput;

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
    },
    [chatActions],
  );

  const getMentionDropdownPosition = useCallback(() => {
    if (!inputRef.current) {
      return { top: 0, left: 0 };
    }

    const inputRect = inputRef.current.getBoundingClientRect();
    const paddingLeft = 8;

    return {
      top: inputRect.bottom + 6,
      left: inputRect.left + paddingLeft,
    };
  }, []);

  // Function to recalculate mention dropdown position
  const recalculateMentionPosition = useCallback(() => {
    if (!mentionState.active) return;
    updatePosition(getMentionDropdownPosition());
  }, [mentionState.active, updatePosition, getMentionDropdownPosition]);

  const getSlashDropdownPosition = useCallback(() => {
    if (!inputRef.current) {
      return { top: 0, left: 0 };
    }

    const inputRect = inputRef.current.getBoundingClientRect();
    const paddingLeft = 8;

    return {
      top: inputRect.bottom + 6,
      left: inputRect.left + paddingLeft,
    };
  }, []);

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

      const storeInput = chatState.input;
      const currentContent = getPlainTextFromDiv();

      // Only sync if store input differs from what's in the DOM and it's an external change
      if (storeInput !== currentContent && storeInput !== lastSyncedInputRef.current) {
        isUpdatingContentRef.current = true;
        setHasInputText(storeInput.trim().length > 0);
        lastSyncedInputRef.current = storeInput;

        inputRef.current.innerHTML = storeInput === "" ? "" : storeInput;

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
  }, [chatState.input, getPlainTextFromDiv]);

  useEffect(() => {
    if (surface !== "harness" || !isInputEnabled) {
      return;
    }

    const handleHarnessSeedKey = (event: KeyboardEvent) => {
      const harnessRoot =
        aiChatContainerRef.current?.closest("[data-ai-chat-surface='harness']") ?? null;
      if (
        !shouldSeedHarnessComposerKeyEvent({
          harnessRoot,
          target: event.target,
          activeTarget: document.activeElement,
        })
      ) {
        return;
      }

      const seedCharacter = getHarnessComposerSeedCharacter({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        isComposing: event.isComposing,
        target: event.target,
      });

      if (!seedCharacter) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const currentDraft = getPlainTextFromDiv();
      syncDraftInput(`${currentDraft}${seedCharacter}`, { focusComposer: true });
    };

    document.addEventListener("keydown", handleHarnessSeedKey, true);
    return () => document.removeEventListener("keydown", handleHarnessSeedKey, true);
  }, [getPlainTextFromDiv, isInputEnabled, surface, syncDraftInput]);

  // Click outside handler for context dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        contextDropdownRef.current &&
        !contextDropdownRef.current.contains(event.target as Node)
      ) {
        chatActions.setIsContextDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [chatActions]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Handle slash command navigation
    if (slashCommandState.active) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectNextSlashCommand(scopeId);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectPreviousSlashCommand(scopeId);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const filteredCommands = chatActions.getFilteredSlashCommands();
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
            chatActions.setInput(newPlainText);

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
            chatActions.setInput(newPlainText);

            return;
          }
        }
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && (isStreaming || chatState.queueCount > 0)) {
        handleQueueFollowUp();
        return;
      }
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
    const currentInput = chatState.input;

    // Only update if content actually changed
    if (plainTextFromDiv !== currentInput) {
      syncDraftInput(plainTextFromDiv);

      // Detect slash commands at start of input (robust against leading whitespace/newlines)
      const normalizedInput = plainTextFromDiv.trimStart();
      if (normalizedInput.startsWith("/")) {
        const slashToken = normalizedInput.slice(1);
        const hasWhitespaceAfterSlash = /\s/.test(slashToken);
        const search = hasWhitespaceAfterSlash ? slashToken.split(/\s+/)[0] : slashToken;

        if (!hasWhitespaceAfterSlash && search.length < 50) {
          showSlashCommands(getSlashDropdownPosition(), search);
        } else {
          hideSlashCommands();
        }
      } else if (slashCommandState.active) {
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
    chatState.input,
    getPlainTextFromDiv,
    debouncedMentionDetection,
    hideMention,
    mentionState.active,
    showSlashCommands,
    hideSlashCommands,
    slashCommandState.active,
    getSlashDropdownPosition,
  ]);

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
                chatActions.addPastedImage({
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
    [chatActions, handleInputChange],
  );

  // Handle file mention selection
  const handleFileMentionSelect = useCallback(
    (file: any) => {
      if (!inputRef.current) return;

      isUpdatingContentRef.current = true;

      const currentInput = chatState.input;
      const beforeMention = currentInput.slice(0, mentionState.startIndex);
      const afterMention = currentInput.slice(
        mentionState.startIndex + mentionState.search.length + 1,
      );
      const newInput = `${beforeMention}@[${file.name}] ${afterMention}`;

      // Update input state and hide mention dropdown
      chatActions.setInput(newInput);
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
      chatState.input,
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
      chatActions.setInput(newInput);
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
    [chatActions, hideSlashCommands],
  );

  const consumeDraftInput = useCallback(() => {
    const currentInput = chatState.input;
    const currentImages = chatState.pastedImages;
    const hasContent = currentInput.trim() || currentImages.length > 0;
    if (!hasContent || !isInputEnabled) return null;

    syncDraftInput("");
    chatActions.clearPastedImages();
    if (inputRef.current) {
      inputRef.current.innerHTML = "";
    }

    return currentInput;
  }, [
    chatActions.clearPastedImages,
    chatActions.setInput,
    chatState.input,
    chatState.pastedImages,
    isInputEnabled,
  ]);

  const handleSendMessage = async () => {
    const currentInput = consumeDraftInput();
    if (currentInput === null) return;

    // Trigger send animation
    chatActions.setIsSendAnimating(true);

    // Reset animation after the flying animation completes
    setTimeout(() => chatActions.setIsSendAnimating(false), 800);

    // Send the captured message (TODO: include images in message)
    await onSendMessage(currentInput);
  };

  const handleQueueFollowUp = useCallback(() => {
    const currentInput = consumeDraftInput();
    if (currentInput === null) return;

    chatActions.addFollowUpMessageToQueue(currentInput);
  }, [chatActions.addFollowUpMessageToQueue, consumeDraftInput]);

  // Get available slash commands
  const hasSlashCommands = chatState.availableSlashCommands.length > 0;
  const placeholder = isInputEnabled
    ? hasSlashCommands
      ? surface === "harness"
        ? "Ask Harness to work on this project... (@ files, / commands)"
        : "Message... (@ files, / commands)"
      : surface === "harness"
        ? "Ask Harness to work on this project... (@ to mention files)"
        : "Message... (@ to mention files)"
    : "Configure API key to enable the AI assistant...";
  const harnessStatusTone = harnessStatus ? getHarnessStatusTone(harnessStatus) : null;

  return (
    <div
      ref={aiChatContainerRef}
      className={cn(
        "ai-chat-container relative z-20 bg-transparent",
        surface === "harness" ? "border-border/70 border-t py-2.5" : "px-3 pt-2 pb-3",
      )}
    >
      <div
        className={cn(
          "border border-border bg-primary-bg/95 backdrop-blur-sm",
          surface === "harness"
            ? "rounded-xl px-2.5 py-2.5"
            : "rounded-[20px] px-3 py-2.5 shadow-sm",
        )}
      >
        {/* Pasted images preview */}
        {chatState.pastedImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {chatState.pastedImages.map((image) => (
              <div
                key={image.id}
                className="group relative overflow-hidden rounded-lg border border-border bg-secondary-bg"
              >
                <img
                  src={image.dataUrl}
                  alt={image.name}
                  className="h-16 w-auto max-w-[120px] object-cover"
                />
                <button
                  onClick={() => chatActions.removePastedImage(image.id)}
                  className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                  aria-label="Remove image"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div
          className={cn(
            surface === "harness"
              ? "rounded-lg border border-border/70 bg-secondary-bg/35 px-2 py-1.5"
              : "",
          )}
        >
          <div
            ref={inputRef}
            contentEditable={isInputEnabled}
            onInput={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            data-placeholder={placeholder}
            className={cn(
              "max-h-[140px] w-full resize-none overflow-y-auto border-none bg-transparent",
              "px-2 py-1.5 text-text",
              "focus:outline-none",
              !isInputEnabled ? "cursor-not-allowed opacity-50" : "cursor-text",
              "empty:before:pointer-events-none empty:before:text-text-lighter empty:before:content-[attr(data-placeholder)]",
              surface === "harness" ? "min-h-[72px]" : "min-h-[64px]",
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
        </div>

        {surface === "harness" && harnessStatus ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-border/70 border-t pt-2 text-[11px]">
            <span className="text-text">{harnessStatus.agentLabel}</span>
            <span className="text-text-lighter/55">/</span>
            <span className="text-text-lighter">{harnessStatus.modeLabel}</span>
            <span className="text-text-lighter/55">/</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 font-medium",
                harnessStatusTone?.textClassName,
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  harnessStatusTone?.dotClassName,
                  harnessStatus.kind === "running" && "animate-pulse",
                )}
                aria-hidden="true"
              />
              {harnessStatusTone?.Icon ? (
                <harnessStatusTone.Icon
                  size={11}
                  className={cn(harnessStatus.kind === "running" && "animate-spin")}
                />
              ) : null}
              <span>{harnessStatus.stateLabel}</span>
            </span>
            {harnessStatus.detail ? (
              <span className="truncate text-text-lighter">{harnessStatus.detail}</span>
            ) : null}
          </div>
        ) : null}

        <div
          className={cn(
            "mt-2.5 flex flex-wrap gap-2 border-border/70 border-t pt-2.5",
            surface === "harness" ? "items-center justify-between" : "items-center",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <div ref={contextDropdownRef} className="min-w-0 flex-1">
              <ContextSelector
                buffers={buffers}
                selectedBufferIds={chatState.selectedBufferIds}
                selectedFilesPaths={chatState.selectedFilesPaths}
                onToggleBuffer={chatActions.toggleBufferSelection}
                onToggleFile={chatActions.toggleFileSelection}
                isOpen={chatState.isContextDropdownOpen}
                onToggleOpen={() =>
                  chatActions.setIsContextDropdownOpen(!chatState.isContextDropdownOpen)
                }
              />
            </div>

            {/* Queue indicator */}
            {chatState.queueCount > 0 && (
              <div
                className="flex items-center gap-1 rounded-md border border-border/70 bg-primary-bg/50 px-2 py-1 text-text-lighter text-xs"
                title={`Queued messages: ${chatState.steeringQueueCount} steering, ${chatState.followUpQueueCount} follow-up`}
              >
                <span className="font-medium text-text">{chatState.queueCount}</span>
                <span>queued</span>
              </div>
            )}
          </div>

          <div className="ml-auto flex shrink-0 select-none flex-wrap items-center gap-1.5">
            {surface === "harness" ? (
              <UnifiedAgentSelector
                scopeId={scopeId}
                surface={surface}
                variant="input"
                onOpenSettings={() => {}}
              />
            ) : null}

            <ChatModeSelector surface={surface} scopeId={scopeId} />

            {surface === "harness" ? (
              <PiNativeRuntimeControls
                scopeId={scopeId}
                agentId={currentAgentId}
                runtimeBackend={runtimeBackend}
                runtimeState={currentRuntimeState}
                disabled={isStreaming}
              />
            ) : null}

            {hasSlashCommands && (
              <button
                onClick={() => {
                  if (inputRef.current && isInputEnabled) {
                    inputRef.current.textContent = "/";
                    chatActions.setInput("/");
                    setHasInputText(true);
                    inputRef.current.focus();
                    // Trigger slash command detection
                    showSlashCommands(getSlashDropdownPosition(), "");
                  }
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-secondary-bg/80 text-text-lighter transition-colors hover:bg-hover hover:text-text"
                title="Show slash commands"
              >
                <Slash size={12} />
              </button>
            )}

            <Button
              type="submit"
              disabled={isSendDisabled}
              onClick={isStreaming ? onStopStreaming : handleSendMessage}
              className={cn(
                "flex items-center justify-center rounded-full border border-border bg-secondary-bg/80 p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text",
                "send-button-hover button-transition focus:outline-none focus:ring-2 focus:ring-accent/50",
                surface === "harness" ? "h-10 w-10" : "h-8 w-8",
                isStreaming && !chatState.isSendAnimating && "button-morphing",
                (hasInputText || hasImages) &&
                  isInputEnabled &&
                  "border-border bg-secondary-bg text-text hover:bg-hover hover:text-text",
                isSendDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              )}
              title={
                isStreaming
                  ? "Stop generation (Escape). Enter steers; Ctrl/Cmd+Enter queues a follow-up."
                  : chatState.queueCount > 0
                    ? "Enter adds a steering message. Ctrl/Cmd+Enter queues a follow-up."
                    : "Send message (Enter)"
              }
              aria-label={isStreaming ? "Stop generation" : "Send message"}
              tabIndex={0}
            >
              {isStreaming && !chatState.isSendAnimating ? (
                <Square size={14} className="transition-all duration-300" />
              ) : (
                <Send
                  size={14}
                  className={cn(
                    "send-icon transition-all duration-200",
                    chatState.isSendAnimating && "flying",
                  )}
                />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* File Mention Dropdown */}
      {mentionState.active && <FileMentionDropdown onSelect={handleFileMentionSelect} />}

      {/* Slash Command Dropdown */}
      {slashCommandState.active && (
        <SlashCommandDropdown
          scopeId={scopeId}
          surface={surface}
          onSelect={handleSlashCommandSelect}
        />
      )}
    </div>
  );
});

export default AIChatInputBar;
