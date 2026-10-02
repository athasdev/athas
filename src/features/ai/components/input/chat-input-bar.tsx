import { ComposerNotice } from "./composer-notice";
import { isComposingKeyboardEvent } from "@/features/keymaps/utils/is-composing-keyboard-event";
import { getProviderAccessFromMap } from "@/features/ai/stores/ai-chat/provider-actions";
import {
  ArrowUpIcon,
  BoltIcon,
  FilePlusIcon,
  MicrophoneIcon,
  PlayIcon,
  StopIcon,
  TerminalIcon,
} from "@/ui/icons";
import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { runChatTerminalCommand } from "@/features/ai/services/chat-terminal-command";
import { getFolderName } from "@/utils/path-helpers";
import { getComposerTerminalCommand } from "@/features/ai/utils/composer-terminal-command";
import { ChromeBar, ChromeGroup, ChromeLabel } from "@/ui/chrome";
import { Kbd } from "@/ui/kbd";
import { useAgentDraft } from "@/features/ai/hooks/use-agent-draft";
import { shouldIgnoreSearchFile } from "@/features/file-search/utils/file-search-filtering";
import {
  AI_CHAT_INSERT_SKILL_EVENT,
  type AIChatSkillInsertDetail,
} from "@/features/ai/lib/skill-events";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { selectChatAcpSession } from "@/features/ai/lib/acp-session-state";
import { useVoiceInput } from "@/features/ai/hooks/use-voice-input";
import { useComposerFileDrop } from "@/features/ai/hooks/use-composer-file-drop";
import { getImageMimeType } from "@/utils/image-file-types";
import { parsePastedImages, restorePastedImages } from "@/features/ai/lib/image-attachments";
import { useToast } from "@/features/layout/contexts/toast-context";
import { isAcpAgent } from "@/features/ai/services/ai-chat-service";
import { useFollowAgentInterrupt } from "./follow-agent-toggle";
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
import type {
  AIChatInputBarProps,
  RestoredComposerPrompt,
} from "@/features/ai/types/ai-chat.types";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { openSidebarResourceBuffer } from "@/features/sidebar/utils/open-sidebar-resource";
import {
  hasSidebarResourceDragData,
  readSidebarResourceDragData,
  SIDEBAR_RESOURCE_DROP_ON_AI_EVENT,
  type SidebarDragResource,
} from "@/features/sidebar/utils/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { ComposerAttachments } from "./composer-attachments";
import Badge, { badgeVariants } from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { Composer, ComposerDropHint, ComposerEditable, ComposerToolbar } from "@/ui/composer";
import { useProjectStore } from "@/features/window/stores/project.store";
import { chatContentWidth } from "../chat/chat-content-width";
import { ComposerAgentSelector } from "./composer-agent-selector";
import { ChatPreferencesMenu } from "./chat-preferences-menu";
import { ComposerModeSelector } from "./composer-mode-selector";
import { useChatModeSource } from "@/features/ai/hooks/use-chat-mode";
import { applyChatModeIntent, cycleChatMode } from "@/features/ai/services/chat-mode-service";
import {
  filterComposerSlashCommands,
  mergeComposerSlashCommands,
  parseLeadingModeCommand,
} from "@/features/ai/lib/composer-slash-commands";
import type {
  ComposerCommandAction,
  ComposerSlashCommand,
} from "@/features/ai/types/composer-slash-command.types";
import { clearChat, compactChat } from "@/features/ai/services/chat-compaction-service";
import { openAgentEditsReview } from "@/features/ai/services/agent-edits-service";
import { pickAgentEditsChatId } from "@/features/ai/stores/agent-edits.store";
import { openNewAgentChat } from "@/features/ai/lib/open-new-agent-chat";
import { AcpContextMeter } from "./acp-context-meter";
import { ComposerContextMeter } from "./composer-context-meter";
import { useComposerContextBudget } from "@/features/ai/hooks/use-composer-context-budget";
import { AgentMessageQueue } from "./agent-message-queue";
import { AgentEditsBar } from "./agent-edits-bar";
import { FileMentionDropdown } from "../mentions/file-mention-dropdown";
import { SlashCommandDropdown } from "../mentions/slash-command-dropdown";
import { ContextSelector } from "../selectors/context-selector";

const AIChatInputBar = memo(function AIChatInputBar({
  chatId,
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
  size = "default",
  autoFocus = false,
  onAgentChange,
  onTerminalChatCreated,
  onSendMessage,
  onInterruptAndSend,
  onMoveQueuedMessage,
  onUpdateQueuedMessage,
  onRemoveQueuedMessage,
  onSendQueuedMessageNow,
  onEditQueuedMessage,
  onStopStreaming,
  lastTurnFailedOffline,
  onRetryLastTurn,
  restoredPrompt,
}: AIChatInputBarProps) {
  const inputRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const aiChatContainerRef = useRef<HTMLDivElement>(null);
  const isUpdatingContentRef = useRef(false);
  const visibleMentionFilesRef = useRef<FileEntry[]>([]);
  const performanceTimer = useRef<number | null>(null);

  // Local state for input emptiness check (to avoid subscribing to full input text)
  const [hasInputText, setHasInputText] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState<string | null>(null);
  const terminalHintId = useId();
  const isTerminalMode = terminalCommand !== null;
  const terminalEnabled = useSettingsStore((state) => state.settings.coreFeatures.terminal);
  const [isContextDragOver, setIsContextDragOver] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const projectPath = useProjectStore((state) => state.rootFolderPath || ".");
  const inputValueRef = useRef("");
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const { showToast } = useToast();
  useAgentDraft({
    surfaceId,
    readDraft: () => ({
      text: inputValueRef.current,
      images: pastedImages,
      bufferIds: [...selectedBufferIds],
      filePaths: [...selectedFilesPaths],
      editorContexts: selectedEditorContexts,
    }),
    restoreDraft: (draft) => {
      inputValueRef.current = draft.text;
      if (inputRef.current) inputRef.current.textContent = draft.text;
      setHasInputText(draft.text.trim().length > 0);
      setTerminalCommand(getComposerTerminalCommand(draft.text));
      setPastedImages(draft.images);
    },
  });
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

  const acpSession = useAIChatStore((state) => selectChatAcpSession(state, chatId));
  const sessionConfigOptions = acpSession.configOptions;
  const session = useAIChatStore((state) => state.chats.find((chat) => chat.id === chatId));
  const acpSessionId = session?.acpSessionId ?? null;
  const modeSource = useChatModeSource(chatId ?? null, currentAgentId);
  const followChatId = chatId && isAcpAgent(currentAgentId) ? chatId : null;
  useFollowAgentInterrupt(followChatId);
  const defaultProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const defaultModelId = useSettingsStore((state) => state.settings.aiModelId);
  const aiProviderId = session?.providerId ?? defaultProviderId;
  const aiModelId = session?.modelId ?? defaultModelId;
  const hasApiKey = useAIChatStore((state) =>
    getProviderAccessFromMap(aiProviderId, state.providerApiKeys),
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);

  // Check if current agent is "custom" (only show model selector for custom agent)
  const isCustomAgent = currentAgentId === "custom";
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const contextBudget = useComposerContextBudget({
    enabled: isCustomAgent,
    chatId: chatId ?? null,
    projectRoot: rootFolderPath ?? null,
    providerId: aiProviderId,
    modelId: aiModelId,
    buffers,
    selectedBufferIds,
    selectedFilesPaths,
    editorContexts: selectedEditorContexts,
  });

  // ACP agents don't need API key (they handle their own auth)
  const isInputEnabled = isCustomAgent ? hasApiKey : true;
  const isStreaming = isTyping && !!streamingMessageId;
  const changeSessionConfigOption = useAIChatStore(
    (state) => state.actions.changeSessionConfigOption,
  );

  const handleApiModelChange = useCallback(
    (nextModelId: string, nextProviderId: string) => {
      if (chatId && isCustomAgent) {
        useAIChatStore.getState().actions.setChatModel(chatId, nextProviderId, nextModelId);
        return;
      }
      if (!chatId) {
        void updateSetting("aiProviderId", nextProviderId);
        void updateSetting("aiModelId", nextModelId);
        if (nextProviderId === "custom") void updateSetting("aiCustomModelId", nextModelId);
      }
      onAgentChange?.("custom", { providerId: nextProviderId, modelId: nextModelId });
    },
    [chatId, isCustomAgent, onAgentChange, updateSetting],
  );

  const skills = useSettingsStore((state) => state.settings.aiSkills);
  const availableSlashCommands = useMemo(
    () =>
      mergeComposerSlashCommands({
        agentCommands: acpSession.slashCommands,
        skills,
        isBuiltInAgent: isCustomAgent,
        availableModeIntents: modeSource.options.flatMap((option) =>
          option.intent ? [option.intent] : [],
        ),
      }),
    [acpSession.slashCommands, isCustomAgent, modeSource.options, skills],
  );
  const filteredSlashCommands = useMemo(
    () => filterComposerSlashCommands(availableSlashCommands, slashCommandState.search),
    [availableSlashCommands, slashCommandState.search],
  );

  const setInput = useCallback((input: string) => {
    inputValueRef.current = input;
    setTerminalCommand(getComposerTerminalCommand(input));
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

  const { isDraggingFiles, attachImages, attachPaths, attachTransfer } = useComposerFileDrop({
    targetRef: composerRef,
    scopeId: JSON.stringify([surfaceId, chatId, currentAgentId]),
    onImages: (images) => setPastedImages((current) => [...current, ...images]),
    onPaths: (paths) => setSelectedFilesPaths(new Set([...selectedFilesPaths, ...paths])),
    onError: (message) => showToast({ message, type: "error" }),
  });

  const addSidebarResourceToContext = useCallback(
    async (resource: SidebarDragResource) => {
      if (resource.type === "file") {
        if (!resource.isDir && getImageMimeType(resource.path)) {
          await attachPaths([resource.path]);
          return;
        }
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
    [addBufferToContext, addPathToContext, attachPaths, buffers],
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
    if (
      !hasSidebarResourceDragData(event.dataTransfer) &&
      !Array.from(event.dataTransfer.types).includes("Files")
    )
      return;
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
      if (!resource && !Array.from(event.dataTransfer.types).includes("Files")) return;

      event.preventDefault();
      event.stopPropagation();
      setIsContextDragOver(false);
      if (resource) await addSidebarResourceToContext(resource);
      else await attachTransfer(event.dataTransfer);
    },
    [addSidebarResourceToContext, attachTransfer],
  );

  // Computed state for send button
  const hasImages = pastedImages.length > 0;
  const isSendDisabled = isTerminalMode
    ? !terminalEnabled || !terminalCommand
    : (!hasInputText && !hasImages) || !isInputEnabled;
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
    if (e.defaultPrevented || isComposingKeyboardEvent(e.nativeEvent)) return;
    if (getComposerTerminalCommand(inputValueRef.current) !== null) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        replaceInput(inputValueRef.current.trimStart().slice(1));
        closeInlineMenus();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) handleSendMessage();
        return;
      }
    }
    if (
      e.key === "Tab" &&
      e.shiftKey &&
      !slashCommandState.active &&
      !mentionState.active &&
      cycleChatMode(modeSource)
    ) {
      e.preventDefault();
      return;
    }
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
      if (e.repeat) return;
      if (isStreaming && (e.metaKey || e.ctrlKey)) handleInterruptAndSend();
      else handleSendMessage();
    }
  };

  // Debounced mention detection - increased delay for better performance
  const debouncedMentionDetection = useCallback(() => {
    if (performanceTimer.current) {
      clearTimeout(performanceTimer.current);
    }

    performanceTimer.current = window.setTimeout(() => {
      if (!inputRef.current) return;
      if (getComposerTerminalCommand(inputValueRef.current) !== null) return;

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

      if (getComposerTerminalCommand(plainTextFromDiv) !== null) {
        closeInlineMenus();
        return;
      }

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
    closeInlineMenus,
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
          if (file) void attachImages([file]);
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
    [handleInputChange, attachImages],
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
        badgeVariants({ tone: "accent" }),
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

  const runSlashCommandAction = (action: ComposerCommandAction) => {
    const notify = (message: string) => showToast({ message, type: "info" });
    switch (action.type) {
      case "mode": {
        const mode = applyChatModeIntent(modeSource, action.intent);
        notify(mode ? `Mode: ${mode.label}` : "This agent has no matching mode.");
        return;
      }
      case "skill": {
        const skill = skills.find((candidate) => candidate.id === action.skillId);
        if (skill) insertSkillAtCursor(skill);
        return;
      }
      case "new":
        openNewAgentChat(currentAgentId);
        return;
      case "review":
        if (chatId && pickAgentEditsChatId(chatId) === chatId) openAgentEditsReview(chatId);
        else notify("No agent changes to review in this chat.");
        return;
      case "compact":
      case "clear":
        if (!chatId) return;
        if (isTyping) {
          notify("Wait for the current response to finish.");
          return;
        }
        if (action.type === "clear") {
          void clearChat(chatId).catch((error: unknown) => {
            console.error("Failed to clear the chat:", error);
            showToast({ message: "Could not clear this chat.", type: "error" });
          });
          return;
        }
        void compactChat(chatId)
          .then((count) =>
            notify(count > 0 ? `Summarised ${count} earlier messages.` : "Nothing to compact yet."),
          )
          .catch((error: unknown) => {
            console.error("Failed to compact the chat:", error);
            showToast({ message: "Could not compact this chat.", type: "error" });
          });
        return;
    }
  };

  const handleSlashCommandSelect = (command: SlashCommand) => {
    if (!inputRef.current) return;

    isUpdatingContentRef.current = true;
    const { startIndex, endIndex } = slashCommandRangeRef.current;
    hideSlashCommands();
    const commandRange = getComposerTextRange(inputRef.current, startIndex, endIndex);
    commandRange.deleteContents();

    const action = (command as ComposerSlashCommand).action;
    if (action) {
      const selection = window.getSelection();
      if (selection) {
        commandRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(commandRange);
      }
      inputRef.current.focus();
      syncInputFromEditable();
      isUpdatingContentRef.current = false;
      runSlashCommandAction(action);
      return;
    }

    const commandSpan = document.createElement("span");
    commandSpan.setAttribute("data-slash-command", "true");
    commandSpan.setAttribute("data-slash-command-name", command.name);
    commandSpan.setAttribute("contenteditable", "false");
    commandSpan.title = command.description || `/${command.name}`;
    commandSpan.className = cn(
      badgeVariants({ tone: "neutral" }),
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
  };

  const handleSendMessage = () => {
    const currentInput = inputValueRef.current;
    const command = getComposerTerminalCommand(currentInput);
    if (command !== null) {
      if (!command || !terminalEnabled) return;
      try {
        const targetChatId = runChatTerminalCommand({
          chatId,
          agentId: currentAgentId,
          command,
          workingDirectory: projectPath,
        });
        setInput("");
        setHasInputText(false);
        if (inputRef.current) inputRef.current.textContent = "";
        closeInlineMenus();
        if (!chatId) onTerminalChatCreated?.(targetChatId);
      } catch (error) {
        showToast({ message: String(error), type: "error" });
      }
      return;
    }
    const currentImages = pastedImages;
    const modeCommand = parseLeadingModeCommand(currentInput, availableSlashCommands);
    if (modeCommand) {
      runSlashCommandAction({ type: "mode", intent: modeCommand.intent });
      if (!modeCommand.prompt && currentImages.length === 0) {
        replaceInput("");
        return;
      }
    }
    const prompt = modeCommand ? modeCommand.prompt : currentInput;
    const hasContent = prompt.trim() || currentImages.length > 0;
    if (!hasContent || !isInputEnabled) return;

    let images;
    try {
      images = parsePastedImages(currentImages);
    } catch (error) {
      showToast({ message: String(error), type: "error" });
      return;
    }
    const result = onSendMessage(prompt, images);
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

  const restorePrompt = useEffectEvent((prompt: RestoredComposerPrompt) => {
    // Never overwrite something the user already started typing.
    if (inputValueRef.current.trim() || pastedImages.length > 0) return;
    replaceInput(prompt.content);
    setPastedImages(restorePastedImages(prompt.images));
  });
  useEffect(() => {
    if (restoredPrompt) restorePrompt(restoredPrompt);
  }, [restoredPrompt]);

  const handleInterruptAndSend = () => {
    const currentInput = inputValueRef.current;
    if ((!currentInput.trim() && !pastedImages.length) || !isInputEnabled) return;
    let images;
    try {
      images = parsePastedImages(pastedImages);
    } catch (error) {
      showToast({ message: String(error), type: "error" });
      return;
    }
    const result = onInterruptAndSend(currentInput, images);
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

  const isDropActive = isContextDragOver || isDraggingFiles;
  const inputPlaceholder = "Ask anything, @ to add context";

  useEffect(() => {
    if (!autoFocus || !isActiveSurface) return;

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, isActiveSurface]);

  const sendControls = isTerminalMode ? (
    <Button
      type="button"
      disabled={isSendDisabled}
      onClick={handleSendMessage}
      variant="accent"
      tooltip="Run command"
      shortcut="enter"
      iconOnly
    >
      <PlayIcon />
    </Button>
  ) : isTyping ? (
    <>
      {hasInputText || hasImages ? (
        <>
          {isStreaming ? (
            <Button
              type="button"
              disabled={isSendDisabled}
              onClick={handleInterruptAndSend}
              variant="ghost"
              tooltip="Interrupt and send now"
              shortcut="mod+enter"
              iconOnly
            >
              <BoltIcon />
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={isSendDisabled}
            onClick={handleSendMessage}
            variant="ghost"
            tone="accent"
            tooltip="Send after current response"
            shortcut="enter"
            iconOnly
          >
            <ArrowUpIcon />
          </Button>
        </>
      ) : null}
      <Button
        type="button"
        onClick={onStopStreaming}
        variant="default"
        tooltip="Stop generation"
        shortcut="escape"
        iconOnly
      >
        <StopIcon />
      </Button>
    </>
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
      <ArrowUpIcon />
    </Button>
  );

  return (
    <div
      ref={aiChatContainerRef}
      className={cn(
        "relative z-20 flex min-w-0 shrink-0 flex-col gap-1.5",
        size === "roomy" ? "w-full" : [chatContentWidth(), "mb-3"],
      )}
    >
      {!isTerminalMode && chatId ? <AgentEditsBar chatId={chatId} /> : null}
      {!isTerminalMode && (
        <AgentMessageQueue
          messages={queuedMessages}
          onUpdate={onUpdateQueuedMessage}
          onMove={onMoveQueuedMessage}
          onRemove={onRemoveQueuedMessage}
          onSendNow={onSendQueuedMessageNow}
          onEditingChange={onEditQueuedMessage}
        />
      )}
      <Composer
        ref={composerRef}
        data-ai-element="prompt-input"
        data-ai-context-drop-target
        onDragOver={handleContextDragOver}
        onDragLeave={handleContextDragLeave}
        onDrop={handleContextDrop}
        dragActive={isDropActive}
      >
        {!isTerminalMode ? (
          <ComposerNotice
            builtInAgent={isCustomAgent}
            providerId={aiProviderId}
            providerBlocked={!hasApiKey}
            lastTurnFailedOffline={lastTurnFailedOffline}
            onRetryLastTurn={onRetryLastTurn}
          />
        ) : null}
        {isTerminalMode ? (
          <div className="px-3 pt-2.5">
            <ChromeBar region="content" surface="transparent">
              <Badge tone="accent">
                <TerminalIcon />
                Terminal
              </Badge>
              <ChromeLabel title={projectPath}>
                {projectPath === "." ? "Default directory" : getFolderName(projectPath)}
              </ChromeLabel>
            </ChromeBar>
          </div>
        ) : (
          <ComposerAttachments
            buffers={buffers}
            selectedBufferIds={selectedBufferIds}
            selectedFilesPaths={selectedFilesPaths}
            selectedEditorContexts={selectedEditorContexts}
            pastedImages={pastedImages}
            contextTriggerRef={contextTriggerRef}
            onRemove={(source) => {
              if (source.type === "buffer") toggleBufferSelection(source.id);
              else if (source.type === "file") toggleFileSelection(source.id);
              else if (source.type === "selection") onRemoveEditorContext(source.id);
              else removePastedImage(source.id);
            }}
          />
        )}

        <ComposerEditable
          ref={inputRef}
          data-ai-element="prompt-input-editable"
          contentEditable
          font={isTerminalMode ? "mono" : "sans"}
          size={size}
          onInput={handleInputChange}
          onKeyDown={handleKeyDown}
          onMouseDown={handleEditableMouseDown}
          onFocus={() => setIsComposerFocused(true)}
          onBlur={() => setIsComposerFocused(false)}
          onPaste={handlePaste}
          data-placeholder={inputPlaceholder}
          role="textbox"
          aria-multiline
          aria-label={isTerminalMode ? "Terminal command" : "Message input"}
          aria-describedby={isTerminalMode ? terminalHintId : undefined}
          tabIndex={0}
        />

        {isTerminalMode ? (
          <ComposerToolbar>
            <ChromeGroup grow>
              <ChromeLabel id={terminalHintId}>
                {terminalEnabled
                  ? "Enter to run · Output appears in chat"
                  : "Enable Terminal in Settings to run commands"}
              </ChromeLabel>
            </ChromeGroup>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => replaceInput(inputValueRef.current.trimStart().slice(1))}
              tooltip="Back to chat"
              shortcut="escape"
            >
              <Kbd>Esc</Kbd>Back to chat
            </Button>
            {sendControls}
          </ComposerToolbar>
        ) : (
          <ComposerToolbar>
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
            <ComposerModeSelector source={modeSource} onBeforeOpen={closeInlineMenus} />
            <ComposerAgentSelector
              cwd={projectPath}
              currentAgentId={currentAgentId}
              providerId={aiProviderId}
              modelId={aiModelId}
              sessionConfigOptions={sessionConfigOptions}
              onAgentChange={onAgentChange}
              onModelChange={handleApiModelChange}
              onSessionConfigChange={(optionId, value) => {
                if (acpSessionId) void changeSessionConfigOption(acpSessionId, optionId, value);
              }}
              onBeforeOpen={closeInlineMenus}
              followChatId={followChatId}
            />

            <div className="ml-auto flex shrink-0 items-center gap-1">
              {contextBudget ? (
                <ComposerContextMeter budget={contextBudget} />
              ) : (
                <AcpContextMeter usage={acpSession.usage} />
              )}
              <ChatPreferencesMenu
                currentAgentId={currentAgentId}
                canChangeAgent={Boolean(onAgentChange)}
                sessionConfigOptions={sessionConfigOptions}
                onSessionConfigChange={(optionId, value) => {
                  if (acpSessionId) void changeSessionConfigOption(acpSessionId, optionId, value);
                }}
                onSelectSkill={insertSkillAtCursor}
                onSelectCodexSkill={insertCodexSkillAtCursor}
                onBeforeOpen={closeInlineMenus}
              />
              {isSpeechRecognitionSupported || isMacDevSpeechRecognitionBlocked ? (
                <Button
                  type="button"
                  disabled={!isInputEnabled || !isSpeechRecognitionSupported}
                  active={isListening}
                  aria-pressed={isListening}
                  onClick={toggleVoiceInput}
                  variant="ghost"
                  tone={isListening ? "accent" : "default"}
                  iconOnly
                  tooltip={
                    isMacDevSpeechRecognitionBlocked
                      ? "Voice input is unavailable in macOS development builds. Use a packaged build."
                      : isListening
                        ? interimTranscript || "Stop voice input"
                        : "Start voice input"
                  }
                  aria-label={isListening ? "Stop voice input" : "Start voice input"}
                >
                  <MicrophoneIcon className={cn(isListening && "animate-pulse")} />
                </Button>
              ) : null}
              {sendControls}
            </div>
          </ComposerToolbar>
        )}
        {isDropActive ? (
          <ComposerDropHint>
            <FilePlusIcon />
            Drop to add as context
          </ComposerDropHint>
        ) : null}
      </Composer>

      {!isTerminalMode && (isActiveSurface || isComposerFocused) && mentionState.active && (
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

      {!isTerminalMode && slashCommandState.active && (
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
    </div>
  );
});

export default AIChatInputBar;
