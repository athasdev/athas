import {
  CommandIcon,
  ArrowUpIcon as ArrowUp,
  CodeBlockIcon as CodeBlock,
  DatabaseIcon as Database,
  FileTextIcon as FileText,
  LightningIcon as Lightning,
  MicrophoneIcon as Mic,
  StopIcon as Stop,
  XIcon as X,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { registerAgentDraft, takeAgentDraft } from "@/features/ai/detached/agent-window-drafts";
import { shouldIgnoreSearchFile } from "@/features/file-search/utils/file-search-filtering";
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
import { badgeVariants } from "@/ui/badge";
import { Button } from "@/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/ui/button-group";
import { cn } from "@/utils/cn";
import { Composer, ComposerEditable, ComposerToolbar } from "@/ui/composer";
import { chatContentWidth } from "../chat/chat-content-width";
import { ChatPreferencesMenu } from "./chat-preferences-menu";
import { AgentMessageQueue } from "./agent-message-queue";
import { FileMentionDropdown } from "../mentions/file-mention-dropdown";
import { SlashCommandDropdown } from "../mentions/slash-command-dropdown";
import { ContextSelector } from "../selectors/context-selector";

const AIChatInputBar = memo(function AIChatInputBar({
  buffers,
  allProjectFiles,
  surfaceId,
  currentAgentId,
  isTyping,
  streamingMessageId,
  queuedMessages,
  selectedBufferIds,
  selectedFilesPaths,
  selectedEditorContexts,
  onToggleBufferSelection,
  onToggleFileSelection,
  onSetSelectedBufferIds,
  onSetSelectedFilesPaths,
  onRemoveEditorContext,
  isActiveSurface = true,
  presentation = "default",
  autoFocus = false,
  onAgentChange,
  onSendMessage,
  onInterruptAndSend,
  onMoveQueuedMessage,
  onRemoveQueuedMessage,
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
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const inputValueRef = useRef("");
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const draftReader = useRef(() => ({
    text: inputValueRef.current,
    images: pastedImages,
    bufferIds: [...selectedBufferIds],
    filePaths: [...selectedFilesPaths],
    editorContexts: selectedEditorContexts,
  }));
  draftReader.current = () => ({
    text: inputValueRef.current,
    images: pastedImages,
    bufferIds: [...selectedBufferIds],
    filePaths: [...selectedFilesPaths],
    editorContexts: selectedEditorContexts,
  });
  useLayoutEffect(() => {
    const draft = takeAgentDraft(surfaceId);
    if (draft) {
      inputValueRef.current = draft.text;
      if (inputRef.current) inputRef.current.textContent = draft.text;
      setHasInputText(draft.text.trim().length > 0);
      setPastedImages(draft.images);
    }
    return registerAgentDraft(surfaceId, () => draftReader.current());
  }, [surfaceId]);
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
  }, [
    slashCommandState.active,
    hideSlashCommands,
    isContextDropdownOpen,
    setIsContextDropdownOpen,
    mentionState.active,
    hideMention,
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
  const isSendDisabled = (!hasInputText && !hasImages) || !isInputEnabled;
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
    () => allProjectFiles.filter((file) => !file.isDir && !shouldIgnoreSearchFile(file.path)),
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

    const editorSelections = selectedEditorContexts.map((context) => ({
      type: "selection" as const,
      id: context.id,
      name: `${context.fileName}:${
        context.startLine === context.endLine
          ? context.startLine
          : `${context.startLine}-${context.endLine}`
      }`,
      path: context.filePath,
    }));

    return [...editorSelections, ...bufferSelections, ...fileSelections];
  }, [buffers, selectedBufferIds, selectedEditorContexts, selectedFilesPaths]);

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

  const insertSkillContentAtCursor = useCallback(
    (content: string) => {
      if (!inputRef.current || !content.trim()) return;

      const selection = window.getSelection();
      const range = document.createRange();
      const currentText = getPlainTextFromDiv();
      const prefix = currentText.trim().length > 0 && !/\s$/.test(currentText) ? "\n\n" : "";
      const textNode = document.createTextNode(`${prefix}${content.trim()} `);

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

  const insertSkillAtCursor = useCallback(
    (skill: AIChatSkill) => insertSkillContentAtCursor(skill.content),
    [insertSkillContentAtCursor],
  );

  const insertCodexSkillAtCursor = useCallback(
    (skillName: string) => insertSkillContentAtCursor(`$${skillName}`),
    [insertSkillContentAtCursor],
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
      mentionSpan.className = cn(
        badgeVariants({ variant: "accent" }),
        "max-w-48 truncate align-baseline select-none",
      );
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
      commandSpan.className = cn(
        badgeVariants({ variant: "muted" }),
        "max-w-48 truncate align-baseline select-none",
      );
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

  const handleSendMessage = () => {
    const currentInput = inputValueRef.current;
    const currentImages = pastedImages;
    const hasContent = currentInput.trim() || currentImages.length > 0;
    if (!hasContent || !isInputEnabled) return;

    const result = onSendMessage(currentInput);
    if (!result.accepted) return;

    setInput("");
    setHasInputText(false);
    clearPastedImages();
    if (inputRef.current) {
      inputRef.current.innerHTML = "";
    }
  };

  const replaceInput = useCallback(
    (value: string) => {
      if (!inputRef.current) return;
      inputRef.current.textContent = value;
      setInput(value);
      setHasInputText(value.trim().length > 0);
      inputRef.current.focus();

      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(inputRef.current);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    },
    [setInput],
  );

  const handleInterruptAndSend = () => {
    const currentInput = inputValueRef.current;
    if (!currentInput.trim() || !isInputEnabled) return;
    const result = onInterruptAndSend(currentInput);
    if (!result.accepted) return;

    replaceInput("");
    clearPastedImages();
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
    <Composer
      ref={aiChatContainerRef}
      data-ai-element="prompt-input"
      data-ai-context-drop-target
      onDragOver={handleContextDragOver}
      onDragLeave={handleContextDragLeave}
      onDrop={handleContextDrop}
      dragActive={isContextDragOver}
      className={cn(
        "ai-chat-container z-20",
        isInitialPresentation ? "w-full" : [chatContentWidth(), "mb-3"],
      )}
    >
      {pastedImages.length > 0 && (
        <AttachmentGroup className="px-3 pt-3">
          {pastedImages.map((image) => (
            <Attachment key={image.id} orientation="vertical">
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

      {selectedContextItems.length > 0 ? (
        <AttachmentGroup className="px-3 pt-3" role="list" aria-label="Selected context">
          {selectedContextItems.map((item) => (
            <Attachment
              key={`selected-${item.type}-${item.id}`}
              data-context-chip
              role="listitem"
              tabIndex={0}
              aria-label={`${item.name}. Press Delete to remove from context.`}
              title={item.type === "buffer" ? item.name : item.path}
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
                  } else if (item.type === "file") {
                    toggleFileSelection(item.id);
                  } else {
                    onRemoveEditorContext(item.id);
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
                {item.type === "selection" ? (
                  <CodeBlock />
                ) : item.type === "buffer" ? (
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
                    } else if (item.type === "file") {
                      toggleFileSelection(item.id);
                    } else {
                      onRemoveEditorContext(item.id);
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

      <ComposerEditable
        ref={inputRef}
        data-ai-element="prompt-input-editable"
        enabled={isInputEnabled}
        contentEditable={isInputEnabled}
        onInput={handleInputChange}
        onKeyDown={handleKeyDown}
        onMouseDown={handleEditableMouseDown}
        onFocus={() => setIsComposerFocused(true)}
        onBlur={() => setIsComposerFocused(false)}
        onPaste={handlePaste}
        data-placeholder={inputPlaceholder}
        role="textbox"
        aria-multiline
        aria-label="Message input"
        tabIndex={isInputEnabled ? 0 : -1}
      />

      <ComposerToolbar>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <ContextSelector
            buffers={buffers}
            selectedBufferIds={selectedBufferIds}
            selectedFilesPaths={selectedFilesPaths}
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
            onSelectSkill={insertSkillAtCursor}
            onSelectCodexSkill={insertCodexSkillAtCursor}
            onBeforeOpen={closeInlineMenus}
          />
        </div>

        <AgentMessageQueue
          messages={queuedMessages}
          onEdit={(index) => {
            const message = queuedMessages[index];
            if (!message) return;
            onRemoveQueuedMessage(index, "edit");
            replaceInput(message);
          }}
          onMove={onMoveQueuedMessage}
          onRemove={(index) => onRemoveQueuedMessage(index, "discard")}
        />

        <div className="ml-auto flex shrink-0 items-center gap-1">
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
              disabled={!isInputEnabled}
              iconOnly
              active={slashCommandState.active}
              tooltip="Show slash commands"
              aria-label="Show slash commands"
            >
              <CommandIcon />
            </Button>
          )}

          <Button
            type="button"
            disabled={!isInputEnabled || !isSpeechRecognitionSupported}
            active={isListening}
            aria-pressed={isListening}
            onClick={toggleVoiceInput}
            variant={isListening ? "accent-ghost" : "ghost"}
            iconOnly
            tooltip={
              isMacDevSpeechRecognitionBlocked
                ? "Voice input is unavailable in macOS development builds. Use a packaged build."
                : !isSpeechRecognitionSupported
                  ? "Voice input is not supported by this webview"
                  : isListening
                    ? interimTranscript || "Stop voice input"
                    : "Start voice input"
            }
            aria-label={isListening ? "Stop voice input" : "Start voice input"}
          >
            <Mic className={cn(isListening && "animate-pulse")} />
          </Button>

          {isStreaming ? (
            <ButtonGroup variant="ghost">
              <Button
                type="button"
                disabled={isSendDisabled}
                onClick={handleSendMessage}
                variant="accent"
                tooltip="Send after current response"
                shortcut="enter"
                iconOnly
              >
                <ArrowUp />
              </Button>
              <ButtonGroupSeparator />
              <Button
                type="button"
                disabled={isSendDisabled || hasImages}
                onClick={handleInterruptAndSend}
                variant="accent-ghost"
                tooltip="Interrupt and send now"
                iconOnly
              >
                <Lightning />
              </Button>
              <ButtonGroupSeparator />
              <Button
                type="button"
                onClick={onStopStreaming}
                variant="danger"
                tooltip="Stop generation"
                shortcut="escape"
                iconOnly
              >
                <Stop />
              </Button>
            </ButtonGroup>
          ) : (
            <Button
              type="button"
              disabled={isSendDisabled}
              onClick={handleSendMessage}
              variant="accent"
              tooltip="Send message"
              shortcut="enter"
              iconOnly
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </ComposerToolbar>

      {(isActiveSurface || isComposerFocused) && mentionState.active && (
        <FileMentionDropdown
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
    </Composer>
  );
});

export default AIChatInputBar;
