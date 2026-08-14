import {
  CommandIcon,
  ArrowUpIcon as ArrowUp,
  DatabaseIcon as Database,
  FileTextIcon as FileText,
  MicrophoneIcon as Mic,
  StopIcon as Stop,
  XIcon as X,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shouldIgnoreFile } from "@/features/quick-open/utils/file-filtering";
import {
  AI_CHAT_INSERT_SKILL_EVENT,
  type AIChatSkillInsertDetail,
} from "@/features/ai/lib/skill-events";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useVoiceInput } from "@/features/ai/hooks/use-voice-input";
import {
  getComposerDropdownPosition,
  getComposerText,
  getComposerTextBeforeCaret,
  getComposerTextRange,
  isComposerTokenElement,
} from "@/features/ai/utils/chat-composer-dom";
import type { InlineDropdownPosition, PastedImage } from "@/features/ai/types/chat-composer.types";
import type { AIChatSkill } from "@/features/ai/types/skills.types";
import type { SlashCommand } from "@/features/ai/types/acp.types";
import type { AIChatInputBarProps } from "@/features/ai/types/ai-chat.types";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { getProviderById } from "@/features/ai/types/providers.types";
import { openSidebarResourceBuffer } from "@/features/sidebar/utils/open-sidebar-resource";
import {
  hasSidebarResourceDragData,
  readSidebarResourceDragData,
  SIDEBAR_RESOURCE_DROP_ON_AI_EVENT,
  type SidebarDragResource,
} from "@/features/sidebar/utils/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/ui/attachment";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Toggle } from "@/ui/toggle";
import { cn } from "@/utils/cn";
import {
  ChatComposer,
  ChatComposerBody,
  ChatComposerEditable,
  ChatComposerToolbar,
} from "./chat-composer";
import { ChatPreferencesMenu } from "./chat-preferences-menu";
import { FileMentionDropdown } from "../mentions/file-mention-dropdown";
import { SlashCommandDropdown } from "../mentions/slash-command-dropdown";
import { ContextSelector } from "../selectors/context-selector";
import { ProviderApiKeyCommand } from "../provider-api-key-command";
import { SkillsCommand, type SkillsView } from "../skills/skills-command";

const AIChatInputBar = memo(function AIChatInputBar({
  buffers,
  allProjectFiles,
  surfaceId,
  currentAgentId,
  isTyping,
  streamingMessageId,
  queueCount,
  selectedBufferIds,
  selectedFilesPaths,
  onToggleBufferSelection,
  onToggleFileSelection,
  onSetSelectedBufferIds,
  onSetSelectedFilesPaths,
  isActiveSurface = true,
  presentation = "default",
  autoFocus = false,
  onAgentChange,
  onSendMessage,
  onStopStreaming,
}: AIChatInputBarProps) {
  const inputRef = useRef<HTMLDivElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const aiChatContainerRef = useRef<HTMLDivElement>(null);
  const isUpdatingContentRef = useRef(false);
  const visibleMentionFilesRef = useRef<FileEntry[]>([]);
  const performanceTimer = useRef<number | null>(null);

  // Local state for input emptiness check (to avoid subscribing to full input text)
  const [hasInputText, setHasInputText] = useState(false);
  const [isContextDragOver, setIsContextDragOver] = useState(false);
  const [isSkillsManagerOpen, setIsSkillsManagerOpen] = useState(false);
  const [skillsManagerView, setSkillsManagerView] = useState<SkillsView>("list");
  const [isApiKeyManagerOpen, setIsApiKeyManagerOpen] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const inputValueRef = useRef("");
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const [isContextDropdownOpen, setIsContextDropdownOpen] = useState(false);
  const [mentionState, setMentionState] = useState({
    active: false,
    position: { top: 0, bottom: 0, left: 0, width: 0 },
    search: "",
    startIndex: 0,
    selectedIndex: 0,
  });
  const [slashCommandState, setSlashCommandState] = useState({
    active: false,
    position: { top: 0, bottom: 0, left: 0, width: 0 },
    search: "",
    selectedIndex: 0,
  });
  const slashCommandRangeRef = useRef({ startIndex: 0, endIndex: 0 });

  const hasApiKey = useAIChatStore((state) => state.hasApiKey);
  const sessionConfigOptions = useAIChatStore((state) => state.sessionConfigOptions);
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const aiModelId = useSettingsStore((state) => state.settings.aiModelId);
  const aiCustomModelId = useSettingsStore((state) => state.settings.aiCustomModelId);
  const aiAutocompleteCustomModelId = useSettingsStore(
    (state) => state.settings.aiAutocompleteCustomModelId,
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);

  // Check if current agent is "custom" (only show model selector for custom agent)
  const isCustomAgent = currentAgentId === "custom";

  // ACP agents don't need API key (they handle their own auth)
  const isInputEnabled = isCustomAgent ? hasApiKey : true;
  const isStreaming = isTyping && !!streamingMessageId;
  const changeSessionConfigOption = useAIChatStore(
    (state) => state.actions.changeSessionConfigOption,
  );

  const handleAthasProviderChange = useCallback(
    (nextProviderId: string) => {
      const provider = getProviderById(nextProviderId);
      void updateSetting("aiProviderId", nextProviderId);
      if (nextProviderId === "custom") {
        void updateSetting("aiModelId", aiCustomModelId || aiAutocompleteCustomModelId);
        return;
      }
      if (provider && provider.models.length > 0) {
        void updateSetting("aiModelId", provider.models[0].id);
      }
    },
    [aiAutocompleteCustomModelId, aiCustomModelId, updateSetting],
  );

  const handleAthasModelChange = useCallback(
    (nextModelId: string) => {
      if (aiProviderId === "custom") {
        void updateSetting("aiCustomModelId", nextModelId);
      }
      void updateSetting("aiModelId", nextModelId);
    },
    [aiProviderId, updateSetting],
  );

  const availableSlashCommands = useAIChatStore((state) => state.availableSlashCommands);
  const filteredSlashCommands = useMemo(() => {
    const search = slashCommandState.search.trim().toLowerCase();
    if (!search) return availableSlashCommands;
    return availableSlashCommands.filter(
      (command) =>
        command.name.toLowerCase().includes(search) ||
        command.description?.toLowerCase().includes(search),
    );
  }, [availableSlashCommands, slashCommandState.search]);

  const setInput = useCallback((input: string) => {
    inputValueRef.current = input;
  }, []);
  const addPastedImage = useCallback((image: PastedImage) => {
    setPastedImages((current) => [...current, image]);
  }, []);
  const removePastedImage = useCallback((imageId: string) => {
    setPastedImages((current) => current.filter((image) => image.id !== imageId));
  }, []);
  const clearPastedImages = useCallback(() => setPastedImages([]), []);
  const toggleBufferSelection = onToggleBufferSelection;
  const toggleFileSelection = onToggleFileSelection;
  const setSelectedBufferIds = onSetSelectedBufferIds;
  const setSelectedFilesPaths = onSetSelectedFilesPaths;
  const showMention = useCallback(
    (position: InlineDropdownPosition, search: string, startIndex: number) => {
      setMentionState({ active: true, position, search, startIndex, selectedIndex: 0 });
    },
    [],
  );
  const hideMention = useCallback(() => {
    setMentionState((current) => ({ ...current, active: false }));
  }, []);
  const updatePosition = useCallback((position: InlineDropdownPosition) => {
    setMentionState((current) => ({ ...current, position }));
  }, []);
  const setSelectedIndex = useCallback((selectedIndex: number) => {
    setMentionState((current) => ({ ...current, selectedIndex }));
  }, []);
  const showSlashCommands = useCallback((position: InlineDropdownPosition, search: string) => {
    setSlashCommandState({ active: true, position, search, selectedIndex: 0 });
  }, []);
  const hideSlashCommands = useCallback(() => {
    setSlashCommandState((current) => ({ ...current, active: false }));
  }, []);
  const selectNextSlashCommand = useCallback(() => {
    setSlashCommandState((current) => ({
      ...current,
      selectedIndex: Math.min(
        current.selectedIndex + 1,
        Math.max(filteredSlashCommands.length - 1, 0),
      ),
    }));
  }, [filteredSlashCommands.length]);
  const selectPreviousSlashCommand = useCallback(() => {
    setSlashCommandState((current) => ({
      ...current,
      selectedIndex: Math.max(current.selectedIndex - 1, 0),
    }));
  }, []);
  const setSlashCommandSelectedIndex = useCallback((selectedIndex: number) => {
    setSlashCommandState((current) => ({ ...current, selectedIndex }));
  }, []);

  const closeComposerPopovers = useCallback(() => {
    if (slashCommandState.active) {
      hideSlashCommands();
    }
    if (isContextDropdownOpen) {
      setIsContextDropdownOpen(false);
    }
    if (mentionState.active) {
      hideMention();
    }
    if (isSkillsManagerOpen) {
      setIsSkillsManagerOpen(false);
    }
  }, [
    slashCommandState.active,
    hideSlashCommands,
    isContextDropdownOpen,
    setIsContextDropdownOpen,
    mentionState.active,
    hideMention,
    isSkillsManagerOpen,
  ]);

  const closeInlineMenus = useCallback(() => {
    closeComposerPopovers();
  }, [closeComposerPopovers]);

  const addBufferToContext = useCallback(
    (bufferId: string) => {
      if (selectedBufferIds.has(bufferId)) return;
      const nextSelectedBufferIds = new Set(selectedBufferIds);
      nextSelectedBufferIds.add(bufferId);
      setSelectedBufferIds(nextSelectedBufferIds);
    },
    [selectedBufferIds, setSelectedBufferIds],
  );

  const addPathToContext = useCallback(
    (filePath: string) => {
      if (selectedFilesPaths.has(filePath)) return;
      const nextSelectedFilesPaths = new Set(selectedFilesPaths);
      nextSelectedFilesPaths.add(filePath);
      setSelectedFilesPaths(nextSelectedFilesPaths);
    },
    [selectedFilesPaths, setSelectedFilesPaths],
  );

  const addSidebarResourceToContext = useCallback(
    async (resource: SidebarDragResource) => {
      if (resource.type === "file") {
        const matchingBuffer = !resource.isDir
          ? buffers.find((buffer) => buffer.path === resource.path)
          : null;
        if (matchingBuffer) {
          addBufferToContext(matchingBuffer.id);
        } else {
          addPathToContext(resource.path);
        }
        return;
      }

      if (resource.type === "git-worktree") {
        addPathToContext(resource.path);
        return;
      }

      const bufferId = await openSidebarResourceBuffer(resource);
      if (bufferId) {
        addBufferToContext(bufferId);
      }
    },
    [addBufferToContext, addPathToContext, buffers],
  );

  useEffect(() => {
    const handleSidebarResourceDropOnAI = (event: Event) => {
      if (!isActiveSurface || surfaceId !== "activity-sidebar") return;
      const resource = (event as CustomEvent<{ resource?: SidebarDragResource }>).detail?.resource;
      if (!resource) return;
      void addSidebarResourceToContext(resource);
    };

    window.addEventListener(SIDEBAR_RESOURCE_DROP_ON_AI_EVENT, handleSidebarResourceDropOnAI);
    return () =>
      window.removeEventListener(SIDEBAR_RESOURCE_DROP_ON_AI_EVENT, handleSidebarResourceDropOnAI);
  }, [addSidebarResourceToContext, isActiveSurface, surfaceId]);

  const handleContextDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasSidebarResourceDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsContextDragOver(true);
  }, []);

  const handleContextDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget as HTMLElement | null;
    if (!relatedTarget || !event.currentTarget.contains(relatedTarget)) {
      setIsContextDragOver(false);
    }
  }, []);

  const handleContextDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      const resource = readSidebarResourceDragData(event.dataTransfer);
      if (!resource) return;

      event.preventDefault();
      event.stopPropagation();
      setIsContextDragOver(false);
      await addSidebarResourceToContext(resource);
    },
    [addSidebarResourceToContext],
  );

  // Computed state for send button
  const hasImages = pastedImages.length > 0;
  const isSendDisabled = isStreaming ? false : (!hasInputText && !hasImages) || !isInputEnabled;
  const getPlainTextFromDiv = useCallback(() => getComposerText(inputRef.current), []);
  const getTextBeforeCaret = useCallback(() => getComposerTextBeforeCaret(inputRef.current), []);
  const getCaretDropdownPosition = useCallback(
    () => getComposerDropdownPosition(inputRef.current),
    [],
  );

  const getMentionDropdownPosition = useCallback(() => {
    const position = getCaretDropdownPosition();
    if (!inputRef.current) return position;

    const inputRect = inputRef.current.getBoundingClientRect();
    return {
      ...position,
      width: Math.min(360, Math.max(220, inputRect.width - 24)),
    };
  }, [getCaretDropdownPosition]);
  const getSlashDropdownPosition = useCallback(() => {
    const position = getCaretDropdownPosition();
    if (!inputRef.current) return position;

    const inputRect = inputRef.current.getBoundingClientRect();
    return {
      ...position,
      width: Math.min(320, Math.max(180, inputRect.width - 24)),
    };
  }, [getCaretDropdownPosition]);

  const syncInputFromEditable = useCallback(() => {
    const newPlainText = getPlainTextFromDiv();
    setInput(newPlainText);
    setHasInputText(newPlainText.trim().length > 0);
    return newPlainText;
  }, [getPlainTextFromDiv, setInput]);

  const removeComposerToken = useCallback(
    (token: Element) => {
      const parent = token.parentNode;
      const nextSibling = token.nextSibling;
      token.remove();
      if (
        nextSibling?.nodeType === Node.TEXT_NODE &&
        (nextSibling.textContent === "\u200B" || nextSibling.textContent === " ")
      ) {
        nextSibling.remove();
      }

      syncInputFromEditable();

      if (!parent) return;

      const selection = window.getSelection();
      if (!selection) return;

      const range = document.createRange();
      if (nextSibling?.parentNode === parent) {
        range.setStartBefore(nextSibling);
      } else {
        range.selectNodeContents(parent);
        range.collapse(false);
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    },
    [syncInputFromEditable],
  );

  // Function to recalculate mention dropdown position
  const recalculateMentionPosition = useCallback(() => {
    if (!mentionState.active) return;
    updatePosition(getMentionDropdownPosition());
  }, [mentionState.active, updatePosition, getMentionDropdownPosition]);

  const mentionableFiles = useMemo(
    () => allProjectFiles.filter((file) => !file.isDir && !shouldIgnoreFile(file.path)),
    [allProjectFiles],
  );

  const selectedContextItems = useMemo(() => {
    const bufferSelections = buffers
      .filter((buffer) => buffer.type !== "agent" && selectedBufferIds.has(buffer.id))
      .map((buffer) => ({
        type: "buffer" as const,
        id: buffer.id,
        name: buffer.name,
        databaseType: buffer.type === "database" ? buffer.databaseType : undefined,
        isDirty: buffer.type === "editor" && buffer.isDirty,
      }));

    const fileSelections = Array.from(selectedFilesPaths).map((filePath) => ({
      type: "file" as const,
      id: filePath,
      name: filePath.split("/").pop() || "Unknown",
      path: filePath,
    }));

    return [...bufferSelections, ...fileSelections];
  }, [buffers, selectedBufferIds, selectedFilesPaths]);

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
        if (filteredSlashCommands[slashCommandState.selectedIndex]) {
          handleSlashCommandSelect(filteredSlashCommands[slashCommandState.selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideSlashCommands();
      }
    } else if (mentionState.active) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const lastIndex = visibleMentionFilesRef.current.length - 1;
        setSelectedIndex(lastIndex < 0 ? 0 : Math.min(mentionState.selectedIndex + 1, lastIndex));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(Math.max(mentionState.selectedIndex - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const visibleFiles = visibleMentionFilesRef.current;
        if (visibleFiles[mentionState.selectedIndex]) {
          handleFileMentionSelect(visibleFiles[mentionState.selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideMention();
      }
    } else if (e.key === "Backspace" || e.key === "Delete") {
      // Handle composer token deletion
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && inputRef.current) {
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return;

        const container = range.startContainer;
        const offset = range.startOffset;
        let tokenToRemove: Element | null = null;
        const isBackwardDelete = e.key === "Backspace";

        if (container === inputRef.current) {
          const candidateIndex = isBackwardDelete ? offset - 1 : offset;
          const candidateNode = inputRef.current.childNodes[candidateIndex] ?? null;
          if (isComposerTokenElement(candidateNode)) {
            tokenToRemove = candidateNode;
          }
        }

        // Check if cursor is at the beginning of a text node that follows a composer token
        if (!tokenToRemove && container.nodeType === Node.TEXT_NODE) {
          const textContent = container.textContent || "";
          const candidateSibling =
            isBackwardDelete && offset === 0
              ? container.previousSibling
              : !isBackwardDelete && offset === textContent.length
                ? container.nextSibling
                : null;

          if (isComposerTokenElement(candidateSibling)) {
            tokenToRemove = candidateSibling;
          }
        }

        // Check if cursor is right after a composer token (in separator text node)
        if (
          isBackwardDelete &&
          !tokenToRemove &&
          container.nodeType === Node.TEXT_NODE &&
          container.textContent === "\u200B" &&
          offset === 1
        ) {
          const previousSibling = container.previousSibling?.previousSibling ?? null; // Skip the space node

          if (isComposerTokenElement(previousSibling)) {
            tokenToRemove = previousSibling;
          }
        }

        if (tokenToRemove) {
          e.preventDefault();
          removeComposerToken(tokenToRemove);
          return;
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

    // Keep keystrokes local to this composer so sibling surfaces cannot mirror them.
    const currentInput = inputValueRef.current;

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
        if (isContextDropdownOpen) {
          setIsContextDropdownOpen(false);
        }
        showSlashCommands(getSlashDropdownPosition(), search);
      } else if (slashCommandState.active) {
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

  const handleEditableMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!inputRef.current) return;

    const target = event.target as HTMLElement | null;
    const token = target?.closest("[data-mention],[data-slash-command]");
    if (!token || !inputRef.current.contains(token)) return;

    event.preventDefault();
    inputRef.current.focus();

    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.setStartAfter(token);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

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
      const detail = (event as CustomEvent<AIChatSkillInsertDetail>).detail;
      if (!isActiveSurface || detail?.surfaceId !== surfaceId) return;
      insertSkillAtCursor(detail.skill);
    };

    window.addEventListener(AI_CHAT_INSERT_SKILL_EVENT, handleInsertSkill);
    return () => window.removeEventListener(AI_CHAT_INSERT_SKILL_EVENT, handleInsertSkill);
  }, [insertSkillAtCursor, isActiveSurface]);

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
    (file: FileEntry) => {
      if (!inputRef.current) return;

      isUpdatingContentRef.current = true;
      hideMention();
      const mentionRange = getComposerTextRange(
        inputRef.current,
        mentionState.startIndex,
        mentionState.startIndex + mentionState.search.length + 1,
      );
      mentionRange.deleteContents();

      const mentionSpan = document.createElement("span");
      mentionSpan.setAttribute("data-mention", "true");
      mentionSpan.setAttribute("data-mention-name", file.name);
      mentionSpan.setAttribute("data-mention-path", file.path);
      mentionSpan.setAttribute("contenteditable", "false");
      mentionSpan.title = file.path;
      mentionSpan.className =
        "font-sans ui-text-sm inline-flex min-h-6 max-w-45 items-center gap-1 truncate rounded-full border-0 bg-primary/10 px-1.5 py-0.5 leading-row text-primary align-baseline select-none";
      mentionSpan.textContent = file.name;

      const trailingSpace = document.createTextNode(" ");
      const fragment = document.createDocumentFragment();
      fragment.append(mentionSpan, trailingSpace);
      mentionRange.insertNode(fragment);

      const selection = window.getSelection();
      if (selection) {
        const caretRange = document.createRange();
        caretRange.setStart(trailingSpace, trailingSpace.length);
        caretRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caretRange);
      }

      inputRef.current.focus();
      syncInputFromEditable();
      isUpdatingContentRef.current = false;
    },
    [hideMention, mentionState.search.length, mentionState.startIndex, syncInputFromEditable],
  );

  // Handle slash command selection
  const handleSlashCommandSelect = useCallback(
    (command: SlashCommand) => {
      if (!inputRef.current) return;

      isUpdatingContentRef.current = true;
      const { startIndex, endIndex } = slashCommandRangeRef.current;
      hideSlashCommands();
      const commandRange = getComposerTextRange(inputRef.current, startIndex, endIndex);
      commandRange.deleteContents();

      const commandSpan = document.createElement("span");
      commandSpan.setAttribute("data-slash-command", "true");
      commandSpan.setAttribute("data-slash-command-name", command.name);
      commandSpan.setAttribute("contenteditable", "false");
      commandSpan.title = command.description || `/${command.name}`;
      commandSpan.className =
        "font-sans ui-text-sm inline-flex min-h-6 max-w-45 items-center gap-1 truncate rounded-full border-0 bg-accent/70 px-1.5 py-0.5 leading-row text-foreground align-baseline select-none";
      commandSpan.textContent = `/${command.name}`;

      const trailingSpace = document.createTextNode(" ");
      const fragment = document.createDocumentFragment();
      fragment.append(commandSpan, trailingSpace);
      commandRange.insertNode(fragment);

      const selection = window.getSelection();
      if (selection) {
        const caretRange = document.createRange();
        caretRange.setStart(trailingSpace, trailingSpace.length);
        caretRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caretRange);
      }

      inputRef.current.focus();
      syncInputFromEditable();
      isUpdatingContentRef.current = false;
    },
    [hideSlashCommands, syncInputFromEditable],
  );

  const handleSendMessage = async () => {
    const currentInput = inputValueRef.current;
    const currentImages = pastedImages;
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

  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const {
    interimTranscript,
    isListening,
    isMacDevBlocked: isMacDevSpeechRecognitionBlocked,
    isSupported: isSpeechRecognitionSupported,
    toggle: toggleVoiceInput,
  } = useVoiceInput({
    enabled: isInputEnabled,
    insertText: insertTextAtCursor,
    focusInput,
  });

  const hasSlashCommands = availableSlashCommands.length > 0;
  const hasAttachedComposerDropdown = mentionState.active || slashCommandState.active;
  const isInitialPresentation = presentation === "initial";
  const inputPlaceholder = isInputEnabled
    ? isInitialPresentation
      ? "What do you want to create?"
      : hasSlashCommands
        ? "Ask anything... (@ files, / commands)"
        : "Ask anything... (@ to mention files)"
    : "Configure API key to enable Agent...";

  useEffect(() => {
    if (!autoFocus || !isActiveSurface) return;

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, isActiveSurface]);

  return (
    <ChatComposer
      ref={aiChatContainerRef}
      standalone={isInitialPresentation}
      connected={hasAttachedComposerDropdown}
      data-ai-context-drop-target
      onDragOver={handleContextDragOver}
      onDragLeave={handleContextDragLeave}
      onDrop={handleContextDrop}
      dragActive={isContextDragOver}
      className={cn(isInitialPresentation && "w-full")}
    >
      <ChatComposerBody connected={hasAttachedComposerDropdown}>
        {pastedImages.length > 0 && (
          <AttachmentGroup className={cn("px-3 pt-3", isInitialPresentation && "px-4 pt-4")}>
            {pastedImages.map((image) => (
              <Attachment key={image.id} orientation="vertical" size="sm">
                <AttachmentMedia variant="image">
                  <img src={image.dataUrl} alt={image.name} />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{image.name}</AttachmentTitle>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    onClick={() => removePastedImage(image.id)}
                    aria-label={`Remove ${image.name}`}
                  >
                    <X />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </AttachmentGroup>
        )}

        <ChatComposerEditable
          ref={inputRef}
          enabled={isInputEnabled}
          contentEditable={isInputEnabled}
          onInput={handleInputChange}
          onKeyDown={handleKeyDown}
          onMouseDown={handleEditableMouseDown}
          onFocus={() => setIsComposerFocused(true)}
          onBlur={() => setIsComposerFocused(false)}
          onPaste={handlePaste}
          data-placeholder={inputPlaceholder}
          className={cn(
            hasAttachedComposerDropdown && "border-none",
            isInitialPresentation && "max-h-48 min-h-28 overflow-y-auto px-4 py-4 ui-text-base",
          )}
          role="textbox"
          aria-multiline={!isInitialPresentation}
          aria-label="Message input"
          tabIndex={isInputEnabled ? 0 : -1}
        />

        <ChatComposerToolbar className={cn(isInitialPresentation && "items-center px-3 pb-3 pt-0")}>
          <div className="flex min-w-0 flex-1 items-center">
            <ContextSelector
              buffers={buffers}
              selectedBufferIds={selectedBufferIds}
              onToggleBuffer={toggleBufferSelection}
              onToggleFile={toggleFileSelection}
              isOpen={isContextDropdownOpen}
              triggerRef={contextTriggerRef}
              onOpenChange={(open) => {
                if (open) {
                  closeInlineMenus();
                }
                setIsContextDropdownOpen(open);
              }}
            />
          </div>

          {queueCount > 0 && (
            <Badge className="shrink-0 gap-1 bg-primary/10 px-2.5 text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              <span>{queueCount}</span>
            </Badge>
          )}

          <div className="flex shrink-0 items-center gap-1">
            {hasSlashCommands && (
              <Button
                type="button"
                onClick={() => {
                  if (!inputRef.current || !isInputEnabled) return;
                  if (slashCommandState.active) {
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
                  showSlashCommands(getSlashDropdownPosition(), "");
                }}
                variant="ghost"
                size="icon-sm"
                active={slashCommandState.active}
                tooltip="Show slash commands"
                aria-label="Show slash commands"
              >
                <CommandIcon size={12} />
              </Button>
            )}

            <ChatPreferencesMenu
              currentAgentId={currentAgentId}
              providerId={aiProviderId}
              modelId={aiModelId}
              sessionConfigOptions={sessionConfigOptions}
              onAgentChange={onAgentChange}
              onProviderChange={handleAthasProviderChange}
              onModelChange={handleAthasModelChange}
              onSessionConfigChange={(optionId, value) =>
                void changeSessionConfigOption(optionId, value)
              }
              onManageApiKeys={() => {
                closeInlineMenus();
                setIsApiKeyManagerOpen(true);
              }}
              onManageSkills={(view) => {
                closeInlineMenus();
                setSkillsManagerView(view);
                setIsSkillsManagerOpen(true);
              }}
              onSelectSkill={insertSkillAtCursor}
              onBeforeOpen={closeInlineMenus}
            />

            <Toggle
              type="button"
              disabled={!isInputEnabled || !isSpeechRecognitionSupported}
              pressed={isListening}
              onPressedChange={toggleVoiceInput}
              className={cn(
                isListening && "bg-primary/10 text-primary hover:bg-primary/14 hover:text-primary",
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
              size="sm"
            >
              <Mic size={12} className={cn(isListening && "animate-pulse")} />
            </Toggle>

            <Button
              type="button"
              disabled={isSendDisabled}
              onClick={isStreaming ? onStopStreaming : handleSendMessage}
              variant="ghost"
              className={cn(
                isSendDisabled
                  ? "cursor-not-allowed bg-accent/40 text-subtle-foreground opacity-50"
                  : isStreaming
                    ? "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                    : (hasInputText || hasImages) && isInputEnabled
                      ? "bg-primary text-white hover:bg-primary/85 hover:text-white"
                      : "bg-accent/70 text-subtle-foreground hover:bg-accent hover:text-foreground",
              )}
              tooltip={
                isStreaming ? "Stop generation" : queueCount > 0 ? "Add to queue" : "Send message"
              }
              shortcut={isStreaming ? "escape" : "enter"}
              aria-label={isStreaming ? "Stop generation" : "Send message"}
              size="icon-sm"
            >
              {isStreaming ? <Stop /> : <ArrowUp />}
            </Button>
          </div>
        </ChatComposerToolbar>

        {selectedContextItems.length > 0 ? (
          <AttachmentGroup
            className={cn("px-2 pb-2", isInitialPresentation && "px-3 pb-3")}
            role="list"
            aria-label="Selected context"
          >
            {selectedContextItems.map((item) => (
              <Attachment
                key={`selected-${item.type}-${item.id}`}
                size="xs"
                data-context-chip
                role="listitem"
                tabIndex={0}
                aria-label={`${item.name}. Press Delete to remove from context.`}
                title={item.type === "file" ? item.path : item.name}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    const chips = Array.from(
                      event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                        "[data-context-chip]",
                      ) || [],
                    );
                    const currentIndex = chips.indexOf(event.currentTarget);
                    const nextIndex =
                      event.key === "ArrowLeft"
                        ? Math.max(currentIndex - 1, 0)
                        : Math.min(currentIndex + 1, chips.length - 1);
                    chips[nextIndex]?.focus();
                    return;
                  }

                  if (event.key === "Backspace" || event.key === "Delete") {
                    event.preventDefault();
                    const chipContainer = event.currentTarget.parentElement;
                    const chips = Array.from(
                      chipContainer?.querySelectorAll<HTMLElement>("[data-context-chip]") || [],
                    );
                    const currentIndex = chips.indexOf(event.currentTarget);
                    const nextFocusIndex = Math.max(0, Math.min(currentIndex, chips.length - 2));
                    if (item.type === "buffer") {
                      toggleBufferSelection(item.id);
                    } else {
                      toggleFileSelection(item.id);
                    }
                    requestAnimationFrame(() => {
                      const nextChips = Array.from(
                        chipContainer?.querySelectorAll<HTMLElement>("[data-context-chip]") || [],
                      );
                      const nextChip = nextChips[nextFocusIndex];
                      if (nextChip) {
                        nextChip.focus();
                        return;
                      }
                      contextTriggerRef.current?.focus();
                    });
                  }
                }}
              >
                <AttachmentMedia>
                  {item.type === "buffer" ? (
                    item.databaseType ? (
                      <Database />
                    ) : (
                      <FileText />
                    )
                  ) : (
                    <FileText />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>
                    {item.name}
                    {item.type === "buffer" && item.isDirty ? (
                      <span className="ml-1 inline-block size-1.5 rounded-full bg-warning" />
                    ) : null}
                  </AttachmentTitle>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    onClick={() => {
                      if (item.type === "buffer") {
                        toggleBufferSelection(item.id);
                      } else {
                        toggleFileSelection(item.id);
                      }
                    }}
                    aria-label={`Remove ${item.name} from context`}
                    tabIndex={0}
                  >
                    <X weight="bold" />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </AttachmentGroup>
        ) : null}
      </ChatComposerBody>

      {(isActiveSurface || isComposerFocused) && mentionState.active && (
        <FileMentionDropdown
          anchorRef={aiChatContainerRef}
          files={mentionableFiles}
          mentionState={mentionState}
          onClose={hideMention}
          onSelectedIndexChange={setSelectedIndex}
          onSelect={handleFileMentionSelect}
          onVisibleFilesChange={(files) => {
            visibleMentionFilesRef.current = files;
          }}
        />
      )}

      {slashCommandState.active && (
        <SlashCommandDropdown
          anchorRef={aiChatContainerRef}
          slashCommandState={slashCommandState}
          availableSlashCommands={availableSlashCommands}
          filteredCommands={filteredSlashCommands}
          onSelectedIndexChange={setSlashCommandSelectedIndex}
          onSelect={(command) => {
            handleSlashCommandSelect(command);
          }}
          onClose={hideSlashCommands}
        />
      )}

      <SkillsCommand
        isOpen={isSkillsManagerOpen}
        onClose={() => setIsSkillsManagerOpen(false)}
        onSelectSkill={insertSkillAtCursor}
        initialView={skillsManagerView}
      />

      <ProviderApiKeyCommand
        isOpen={isApiKeyManagerOpen}
        onClose={() => setIsApiKeyManagerOpen(false)}
        initialProviderId={aiProviderId}
      />
    </ChatComposer>
  );
});

export default AIChatInputBar;
