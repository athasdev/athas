import {
  BookOpen,
  Command as CommandIcon,
  Key,
  Microphone as Mic,
  PaperPlaneTilt,
  Stop,
  X,
} from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shouldIgnoreFile } from "@/features/quick-open/utils/file-filtering";
import { getPrimarySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import { AI_CHAT_INSERT_SKILL_EVENT } from "@/features/ai/lib/skill-events";
import { useAIChatStore } from "@/features/ai/store/store";
import type { InlineDropdownPosition } from "@/features/ai/store/types";
import type { AIChatSkill } from "@/features/ai/types/skills";
import type { SlashCommand } from "@/features/ai/types/acp";
import type { AIChatInputBarProps } from "@/features/ai/types/ai-chat";
import { getProviderById } from "@/features/ai/types/providers";
import { useSettingsStore } from "@/features/settings/store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import { isMac } from "@/utils/platform";
import { FileMentionDropdown } from "../mentions/file-mention-dropdown";
import { SlashCommandDropdown } from "../mentions/slash-command-dropdown";
import { AcpConfigSelector } from "../selectors/acp-config-selector";
import { ModelSelector } from "../selectors/model-selector";
import { ProviderSelector } from "../selectors/provider-selector";
import { ModeSelector } from "../selectors/mode-selector";
import { ContextSelector } from "../selectors/context-selector";
import { ProviderApiKeyCommand } from "../provider-api-key-command";
import { SkillsCommand } from "../skills/skills-command";
import { ChatLoadingIndicator } from "../chat/chat-loading-indicator";
import { chatComposerIconButtonClassName } from "./chat-composer-control-styles";

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
    "provider" | "model" | "mode" | "commands" | null
  >(null);
  const [isSkillsOpen, setIsSkillsOpen] = useState(false);
  const [isApiKeyManagerOpen, setIsApiKeyManagerOpen] = useState(false);
  const slashCommandRangeRef = useRef({ startIndex: 0, endIndex: 0 });

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
  const sessionModeState = useAIChatStore((state) => state.sessionModeState);
  const acpStatus = useAIChatStore((state) => state.acpStatus);
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const aiModelId = useSettingsStore((state) => state.settings.aiModelId);
  const updateSetting = useSettingsStore((state) => state.updateSetting);

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
  const hasAcpModeOptions = !isCustomAgent && sessionModeState.availableModes.length > 0;
  const hasAcpModelOptions = Boolean(acpModelOption);
  const isAcpMetadataLoading =
    !isCustomAgent &&
    isTyping &&
    (!acpStatus?.initialized || (!hasAcpModeOptions && !hasAcpModelOptions));

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

  const handleAthasProviderChange = useCallback(
    (nextProviderId: string) => {
      const provider = getProviderById(nextProviderId);
      void updateSetting("aiProviderId", nextProviderId);
      if (provider && provider.models.length > 0) {
        void updateSetting("aiModelId", provider.models[0].id);
      }
    },
    [updateSetting],
  );

  const handleAthasModelChange = useCallback(
    (nextModelId: string) => {
      void updateSetting("aiModelId", nextModelId);
    },
    [updateSetting],
  );

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

  const getTextBeforeCaret = useCallback(() => {
    if (!inputRef.current) return getPlainTextFromDiv();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return getPlainTextFromDiv();

    const range = selection.getRangeAt(0);
    if (!inputRef.current.contains(range.startContainer)) return getPlainTextFromDiv();

    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(inputRef.current);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString();
  }, [getPlainTextFromDiv]);

  const getCaretDropdownPosition = useCallback(() => {
    if (!inputRef.current) {
      return { top: 0, bottom: 0, left: 0, width: 0 };
    }

    const inputRect = inputRef.current.getBoundingClientRect();
    const fallbackPosition: InlineDropdownPosition = {
      top: inputRect.top,
      bottom: inputRect.bottom,
      left: inputRect.left + 12,
      width: 320,
    };

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return fallbackPosition;
    }

    const range = selection.getRangeAt(0).cloneRange();
    if (!inputRef.current.contains(range.startContainer)) {
      return fallbackPosition;
    }

    range.collapse(true);
    let rect = range.getClientRects()[0] ?? range.getBoundingClientRect();

    if ((rect.width === 0 && rect.height === 0) || !Number.isFinite(rect.left)) {
      const marker = document.createElement("span");
      marker.textContent = "\u200B";
      range.insertNode(marker);
      rect = marker.getBoundingClientRect();
      const parent = marker.parentNode;
      const nextSibling = marker.nextSibling;
      marker.remove();
      if (parent) {
        const restoreRange = document.createRange();
        if (nextSibling) {
          restoreRange.setStartBefore(nextSibling);
        } else {
          restoreRange.selectNodeContents(parent);
          restoreRange.collapse(false);
        }
        restoreRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(restoreRange);
      }
    }

    if (!Number.isFinite(rect.left) || rect.height === 0) {
      return fallbackPosition;
    }

    const horizontalPadding = 12;
    const left = Math.min(
      Math.max(rect.left, inputRect.left + horizontalPadding),
      inputRect.right - horizontalPadding,
    );

    const position: InlineDropdownPosition = {
      top: rect.top,
      bottom: rect.bottom,
      left,
      width: 320,
    };

    return position;
  }, []);

  const getMentionDropdownPosition = getCaretDropdownPosition;
  const getSlashDropdownPosition = getCaretDropdownPosition;

  // Function to recalculate mention dropdown position
  const recalculateMentionPosition = useCallback(() => {
    if (!mentionState.active) return;
    updatePosition(getMentionDropdownPosition());
  }, [mentionState.active, updatePosition, getMentionDropdownPosition]);

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
  const debouncedMentionDetection = useCallback(() => {
    if (performanceTimer.current) {
      clearTimeout(performanceTimer.current);
    }

    performanceTimer.current = window.setTimeout(() => {
      if (!inputRef.current) return;

      const textBeforeCaret = getTextBeforeCaret();
      const lastAtIndex = textBeforeCaret.lastIndexOf("@");

      if (lastAtIndex !== -1) {
        const afterAt = textBeforeCaret.slice(lastAtIndex + 1);
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
  }, [showMention, hideMention, getMentionDropdownPosition, getTextBeforeCaret]);

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

      const textBeforeCaret = getTextBeforeCaret();
      const slashMatch = textBeforeCaret.match(/(?:^|\s)\/([^\s/]*)$/);
      if (slashMatch && slashMatch[1].length < 50) {
        const search = slashMatch[1];
        const startIndex = textBeforeCaret.length - search.length - 1;
        slashCommandRangeRef.current = {
          startIndex,
          endIndex: textBeforeCaret.length,
        };
        setActiveInlineControl("commands");
        if (isContextDropdownOpen) {
          setIsContextDropdownOpen(false);
        }
        showSlashCommands(getSlashDropdownPosition(), search);
      } else if (slashCommandState.active) {
        setActiveInlineControl(null);
        hideSlashCommands();
      }

      // Only do mention detection if text contains @ and is reasonably short
      if (plainTextFromDiv.includes("@") && plainTextFromDiv.length < 500) {
        debouncedMentionDetection();
      } else if (mentionState.active) {
        hideMention();
      }
    }
  }, [
    setInput,
    getPlainTextFromDiv,
    getTextBeforeCaret,
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

  const insertSkillAtCursor = useCallback(
    (skill: AIChatSkill) => {
      if (!inputRef.current || !skill.content.trim()) return;

      const selection = window.getSelection();
      const range = document.createRange();
      const currentText = getPlainTextFromDiv();
      const prefix = currentText.trim().length > 0 && !/\s$/.test(currentText) ? "\n\n" : "";
      const textNode = document.createTextNode(`${prefix}${skill.content.trim()} `);

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
      setHasInputText(true);
    },
    [getPlainTextFromDiv, handleInputChange],
  );

  useEffect(() => {
    const handleInsertSkill = (event: Event) => {
      const skill = (event as CustomEvent<AIChatSkill>).detail;
      if (!skill) return;
      insertSkillAtCursor(skill);
    };

    window.addEventListener(AI_CHAT_INSERT_SKILL_EVENT, handleInsertSkill);
    return () => window.removeEventListener(AI_CHAT_INSERT_SKILL_EVENT, handleInsertSkill);
  }, [insertSkillAtCursor]);

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
          "ui-font ui-text-xs inline-flex items-center gap-1 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-accent select-none";
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
    [mentionState.startIndex, mentionState.search.length, setInput, hideMention],
  );

  // Handle slash command selection
  const handleSlashCommandSelect = useCallback(
    (command: SlashCommand) => {
      if (!inputRef.current) return;

      isUpdatingContentRef.current = true;

      const currentInput = getPlainTextFromDiv();
      const { startIndex, endIndex } = slashCommandRangeRef.current;
      const beforeCommand = currentInput.slice(0, startIndex);
      const afterCommand = currentInput.slice(endIndex);
      const trailingSpace = afterCommand.startsWith(" ") ? "" : " ";
      const newInput = `${beforeCommand}/${command.name}${trailingSpace}${afterCommand}`;
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
    [getPlainTextFromDiv, setInput, hideSlashCommands],
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
          "overflow-hidden border border-border/70 bg-[color-mix(in_srgb,var(--color-secondary-bg)_82%,var(--color-border)_18%)] pb-1 transition-[border-radius,background-color,border-color]",
          hasAttachedComposerDropdown ? "rounded-t-xl rounded-b-2xl" : "rounded-2xl",
        )}
      >
        <div className="overflow-hidden rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--color-primary-bg)_96%,var(--color-secondary-bg)_4%)]">
          {pastedImages.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
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
                  ? "Ask anything... (@ files, / commands)"
                  : "Ask anything... (@ to mention files)"
                : "Configure API key to enable AI chat..."
            }
            className={cn(
              "max-h-[140px] min-h-[64px] w-full resize-none overflow-x-hidden overflow-y-auto bg-transparent",
              "ui-font ui-text-sm px-3 pt-3 pb-2 text-text placeholder:text-text-lighter",
              "whitespace-pre-wrap focus:outline-none",
              hasAttachedComposerDropdown && "border-none",
              !isInputEnabled ? "cursor-not-allowed opacity-50" : "cursor-text",
              "empty:before:pointer-events-none empty:before:text-text-lighter empty:before:content-[attr(data-placeholder)]",
            )}
            style={
              {
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

          <div className="flex items-end gap-2 px-2 pb-2 pt-1">
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
                selectedItemsClassName="max-h-14 pr-1"
              />
            </div>

            {queueCount > 0 && (
              <Badge
                shape="pill"
                size="sm"
                className="shrink-0 gap-1 border border-accent/30 bg-accent/10 px-2.5 text-accent"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                <span>{queueCount}</span>
              </Badge>
            )}

            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                disabled={!isInputEnabled || !isSpeechRecognitionSupported}
                onClick={toggleVoiceInput}
                variant="ghost"
                size="icon-xs"
                className={cn(
                  chatComposerIconButtonClassName(),
                  isListening && "bg-accent/10 text-accent hover:bg-accent/14 hover:text-accent",
                )}
                tooltip={
                  isMacDevSpeechRecognitionBlocked
                    ? "Voice input is disabled in macOS dev mode"
                    : !isSpeechRecognitionSupported
                      ? "Voice input is not supported"
                      : isListening
                        ? interimTranscript || "Stop voice input"
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
                size="icon-xs"
                className={cn(
                  chatComposerIconButtonClassName(),
                  isSendDisabled
                    ? "cursor-not-allowed text-text-lighter opacity-50"
                    : (hasInputText || hasImages) && isInputEnabled
                      ? "text-accent hover:bg-accent/8 hover:text-accent/80"
                      : "text-text-lighter hover:text-text",
                )}
                tooltip={
                  isStreaming ? "Stop generation" : queueCount > 0 ? "Add to queue" : "Send message"
                }
                shortcut={isStreaming ? "escape" : "enter"}
                aria-label={isStreaming ? "Stop generation" : "Send message"}
              >
                {isStreaming ? <Stop /> : <PaperPlaneTilt />}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-1.5">
          {isAcpMetadataLoading ? (
            <ChatLoadingIndicator label="loading session" compact />
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
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
                    className="max-w-[180px]"
                    menuClassName="!min-w-0 w-max max-w-[240px]"
                  />
                )}

                {isCustomAgent && (
                  <>
                    <ProviderSelector
                      providerId={aiProviderId}
                      onChange={handleAthasProviderChange}
                      appearance="composer"
                      open={activeInlineControl === "provider"}
                      onOpenChange={(open) => {
                        if (open) {
                          closeInlineMenus();
                          setActiveInlineControl("provider");
                          return;
                        }
                        setActiveInlineControl((current) =>
                          current === "provider" ? null : current,
                        );
                      }}
                      triggerClassName="max-w-[128px]"
                      tooltip="Select provider"
                    />
                    <ModelSelector
                      providerId={aiProviderId}
                      modelId={aiModelId}
                      onChange={handleAthasModelChange}
                      appearance="composer"
                      open={activeInlineControl === "model"}
                      onOpenChange={(open) => {
                        if (open) {
                          closeInlineMenus();
                          setActiveInlineControl("model");
                          return;
                        }
                        setActiveInlineControl((current) => (current === "model" ? null : current));
                      }}
                      triggerClassName="max-w-[176px]"
                      tooltip="Select model"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className={chatComposerIconButtonClassName()}
                      tooltip="API keys"
                      aria-label="Manage API keys"
                      onClick={() => {
                        closeInlineMenus();
                        setIsApiKeyManagerOpen(true);
                      }}
                    >
                      <Key />
                    </Button>
                  </>
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
                  iconOnly
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
                        const selection = window.getSelection();
                        if (selection) {
                          const range = document.createRange();
                          range.selectNodeContents(inputRef.current);
                          range.collapse(false);
                          selection.removeAllRanges();
                          selection.addRange(range);
                        }
                        slashCommandRangeRef.current = { startIndex: 0, endIndex: 1 };
                        setActiveInlineControl("commands");
                        showSlashCommands(getSlashDropdownPosition(), "");
                      }
                    }}
                    variant="ghost"
                    size="icon-xs"
                    active={slashCommandState.active}
                    className={chatComposerIconButtonClassName()}
                    tooltip="Show slash commands"
                    aria-label="Show slash commands"
                  >
                    <CommandIcon size={12} />
                  </Button>
                )}
              </div>

              <Button
                type="button"
                onClick={() => {
                  closeInlineMenus();
                  setIsSkillsOpen(true);
                }}
                variant="ghost"
                size="icon-xs"
                className={chatComposerIconButtonClassName("ml-auto shrink-0")}
                tooltip="Skills"
                aria-label="Skills"
              >
                <BookOpen />
              </Button>
            </>
          )}
        </div>
      </div>

      {mentionState.active && (
        <FileMentionDropdown files={mentionableFiles} onSelect={handleFileMentionSelect} />
      )}

      {slashCommandState.active && <SlashCommandDropdown onSelect={handleSlashCommandSelect} />}

      <SkillsCommand
        isOpen={isSkillsOpen}
        onClose={() => setIsSkillsOpen(false)}
        onSelectSkill={insertSkillAtCursor}
      />

      <ProviderApiKeyCommand
        isOpen={isApiKeyManagerOpen}
        onClose={() => setIsApiKeyManagerOpen(false)}
        initialProviderId={aiProviderId}
      />
    </div>
  );
});

export default AIChatInputBar;
