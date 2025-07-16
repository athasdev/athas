import { Database, FileText, Send, Square, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { useAIChatStore } from "../../stores/ai-chat-store";
import { usePersistentSettingsStore } from "../../stores/persistent-settings-store";
import { cn } from "../../utils/cn";
import ModelProviderSelector from "../model-provider-selector";
import Button from "../ui/button";
import ClaudeStatusIndicator from "./claude-status";
import { ContextSelector } from "./context-selector/context-selector";
import { useContextSelectorStore } from "./context-selector/context-selector-store";
import { FileMentionDropdown } from "./file-mention-dropdown";
import type { AIChatInputBarProps } from "./types";

export default function AIChatInputBar({
  buffers,
  allProjectFiles,
  rootFolderPath,
  onSendMessage,
  onStopStreaming,
  onApiKeyRequest,
  onProviderChange,
  hasProviderApiKey,
}: AIChatInputBarProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const aiChatContainerRef = useRef<HTMLDivElement>(null);

  // Get state from stores
  const { aiProviderId, aiModelId } = usePersistentSettingsStore();
  const {
    input,
    isTyping,
    streamingMessageId,
    selectedBufferIds,
    isSendAnimating,
    hasApiKey,
    mentionState,
    setInput,
    toggleBufferSelection,
    setIsSendAnimating,
    showMention,
    hideMention,
    updatePosition,
    selectNext,
    selectPrevious,
    getFilteredFiles,
  } = useAIChatStore();

  // Get context selector state
  const { contextState, showContextSelector, hideContextSelector, addWebUrl } =
    useContextSelectorStore();

  // Function to recalculate mention dropdown position
  const recalculateMentionPosition = useCallback(() => {
    if (!mentionState.active || !inputRef.current) return;

    const textarea = inputRef.current;
    const textareaRect = textarea.getBoundingClientRect();
    const aiChatContainer = textarea.closest(".ai-chat-container");
    const containerRect = aiChatContainer?.getBoundingClientRect();

    // Calculate position relative to the chat container
    const position = {
      top: textareaRect.top, // Position just above the input area
      left: containerRect ? containerRect.left + 8 : textareaRect.left, // Align with container left edge with padding
    };

    updatePosition(position);
  }, [mentionState.active, updatePosition]);

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
    };
  }, [recalculateMentionPosition]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If context selector is open, let it handle the key events
    if (contextState.isOpen) {
      return;
    }

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
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Handle textarea change for @ mentions
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInput(value);

    // Check for @ mention
    const beforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = beforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const afterAt = beforeCursor.slice(lastAtIndex + 1);
      // Check if there's no space between @ and cursor
      if (!afterAt.includes(" ")) {
        // Get textarea position for dropdown
        const textarea = e.target;
        const textareaRect = textarea.getBoundingClientRect();
        const aiChatContainer = textarea.closest(".ai-chat-container");
        const containerRect = aiChatContainer?.getBoundingClientRect();

        // Calculate position relative to the chat container
        const position = {
          top: textareaRect.top, // Position just above the input area
          left: containerRect ? containerRect.left + 8 : textareaRect.left, // Align with container left edge with padding
        };

        // Show new context selector instead of old file mention
        if (afterAt.length === 0) {
          // Just typed @, show context selector
          showContextSelector(position);
          hideMention();
        } else {
          // Typed @something, show old file mention for now (backward compatibility)
          showMention(position, afterAt, lastAtIndex);
          hideContextSelector();
        }
      } else {
        hideMention();
        hideContextSelector();
      }
    } else {
      hideMention();
      hideContextSelector();
    }
  };

  // Handle file mention selection
  const handleFileMentionSelect = (file: any) => {
    const beforeMention = input.slice(0, mentionState.startIndex);
    const afterMention = input.slice(mentionState.startIndex + mentionState.search.length + 1);
    const newInput = `${beforeMention}@${file.name} ${afterMention}`;
    setInput(newInput);
    hideMention();

    // Move cursor after the mention
    setTimeout(() => {
      if (inputRef.current) {
        const newCursorPos = beforeMention.length + file.name.length + 2;
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        inputRef.current.focus();
      }
    }, 0);
  };

  // Handle context selector item selection
  const handleContextItemSelect = (item: any) => {
    // Find the current cursor position and last @ symbol
    const cursorPos = inputRef.current?.selectionStart || 0;
    const beforeCursor = input.slice(0, cursorPos);
    const lastAtIndex = beforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const beforeAt = input.slice(0, lastAtIndex);
      const afterCursor = input.slice(cursorPos);

      // Handle different item types
      if (item.type === "url") {
        const url = item.metadata?.url || item.description || item.name;
        // Add to web provider history if it's a new URL
        if (item.metadata?.isNew) {
          addWebUrl(url);
        }
        const newInput = `${beforeAt}@${url} ${afterCursor}`;
        setInput(newInput);

        // Move cursor after the mention
        setTimeout(() => {
          if (inputRef.current) {
            const newCursorPos = beforeAt.length + url.length + 2;
            inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
            inputRef.current.focus();
          }
        }, 0);
      } else if (item.type?.startsWith("git-")) {
        // Handle git items - use the full item name
        const gitContext = item.name;
        const newInput = `${beforeAt}@${gitContext} ${afterCursor}`;
        setInput(newInput);

        // Move cursor after the mention
        setTimeout(() => {
          if (inputRef.current) {
            const newCursorPos = beforeAt.length + gitContext.length + 2;
            inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
            inputRef.current.focus();
          }
        }, 0);
      } else {
        // Handle files and other types
        const newInput = `${beforeAt}@${item.name} ${afterCursor}`;
        setInput(newInput);

        // Move cursor after the mention
        setTimeout(() => {
          if (inputRef.current) {
            const newCursorPos = beforeAt.length + item.name.length + 2;
            inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
            inputRef.current.focus();
          }
        }, 0);
      }
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !hasApiKey) return;

    // Trigger send animation
    setIsSendAnimating(true);

    // Reset animation after the flying animation completes
    setTimeout(() => setIsSendAnimating(false), 800);

    await onSendMessage();
  };

  return (
    <div ref={aiChatContainerRef} className="border-border border-t bg-terniary-bg">
      {/* Context badges */}
      {aiProviderId !== "claude-code" && selectedBufferIds.size > 0 && (
        <div className="border-border border-b bg-secondary-bg px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-text-lighter text-xs">Context:</span>
            {Array.from(selectedBufferIds).map(bufferId => {
              const buffer = buffers.find(b => b.id === bufferId);
              if (!buffer) return null;
              return (
                <div
                  key={bufferId}
                  className="flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/20 px-1.5 py-0.5 text-blue-300 text-xs transition-all hover:bg-blue-500/30"
                >
                  {buffer.isSQLite ? <Database size={7} /> : <FileText size={7} />}
                  <span className="max-w-20 truncate font-medium">{buffer.name}</span>
                  <button
                    onClick={() => toggleBufferSelection(bufferId)}
                    className="text-blue-300/70 transition-colors hover:text-red-400"
                  >
                    <X size={7} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="px-2 py-1.5">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={
              hasApiKey ? "Ask about your code..." : "Configure API key to enable AI chat..."
            }
            disabled={isTyping || !hasApiKey}
            className={cn(
              "min-h-[60px] flex-1 resize-none border-none bg-transparent",
              "px-3 py-2 text-text text-xs",
              "focus:outline-none disabled:opacity-50",
            )}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="ml-auto flex items-center gap-0.5">
            <ClaudeStatusIndicator
              isActive={aiProviderId === "claude-code"}
              workspacePath={rootFolderPath}
            />
            <ModelProviderSelector
              currentProviderId={aiProviderId}
              currentModelId={aiModelId}
              onProviderChange={onProviderChange}
              onApiKeyRequest={onApiKeyRequest}
              hasApiKey={hasProviderApiKey}
            />
            <Button
              type="submit"
              disabled={(!input.trim() && !isTyping) || !hasApiKey}
              onClick={isTyping && streamingMessageId ? onStopStreaming : handleSendMessage}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded p-0 text-text-lighter hover:bg-hover hover:text-text",
                "send-button-hover button-transition",
                isTyping && streamingMessageId && !isSendAnimating && "button-morphing",
                input.trim() &&
                  !isTyping &&
                  hasApiKey &&
                  "bg-blue-500 text-white hover:bg-blue-600",
                (!input.trim() && !isTyping) || !hasApiKey
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer",
              )}
              title={isTyping && streamingMessageId ? "Stop generation" : "Send message"}
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
      {mentionState.active && (
        <FileMentionDropdown
          files={allProjectFiles}
          onSelect={handleFileMentionSelect}
          rootFolderPath={rootFolderPath}
        />
      )}

      {/* Context Selector */}
      <ContextSelector
        files={allProjectFiles}
        onSelect={handleContextItemSelect}
        rootFolderPath={rootFolderPath}
      />
    </div>
  );
}
