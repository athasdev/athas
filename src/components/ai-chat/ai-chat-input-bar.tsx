import { ChevronDown, Database, FileText, Send, Square, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAIChatStore } from "../../stores/ai-chat-store";
import { usePersistentSettingsStore } from "../../stores/persistent-settings-store";
import { getModelById } from "../../types/ai-provider";
import { cn } from "../../utils/cn";
import ModelProviderSelector from "../model-provider-selector";
import Button from "../ui/button";
import ClaudeStatusIndicator from "./claude-status";
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
  const contextDropdownRef = useRef<HTMLDivElement>(null);
  const aiChatContainerRef = useRef<HTMLDivElement>(null);

  // Get state from stores
  const { aiProviderId, aiModelId } = usePersistentSettingsStore();
  const {
    input,
    isTyping,
    streamingMessageId,
    selectedBufferIds,
    isContextDropdownOpen,
    isSendAnimating,
    hasApiKey,
    mentionState,
    setInput,
    toggleBufferSelection,
    setIsContextDropdownOpen,
    setIsSendAnimating,
    showMention,
    hideMention,
    updatePosition,
    selectNext,
    selectPrevious,
    getFilteredFiles,
  } = useAIChatStore();

  // Get selected buffers for context (memoized)
  const getSelectedBuffers = useMemo(() => {
    return buffers.filter(buffer => selectedBufferIds.has(buffer.id));
  }, [buffers, selectedBufferIds]);

  // Calculate approximate tokens (memoized)
  const calculateTokens = useMemo(() => {
    let totalChars = input.length;

    // Add characters from selected buffers (approximate)
    getSelectedBuffers.forEach(buffer => {
      if (buffer.content && !buffer.isSQLite) {
        totalChars += buffer.content.length;
      }
    });

    // Rough approximation: 1 token ≈ 4 characters for English text
    const estimatedTokens = Math.ceil(totalChars / 4);

    // Get max tokens from current model
    const currentModel = getModelById(aiProviderId, aiModelId);
    const maxTokens = currentModel?.maxTokens || 4096; // Fallback to 4k tokens

    return { estimatedTokens, maxTokens };
  }, [input, getSelectedBuffers, aiProviderId, aiModelId]);

  // Function to recalculate mention dropdown position
  const recalculateMentionPosition = useCallback(() => {
    if (!mentionState.active || !inputRef.current) return;

    const textarea = inputRef.current;
    const value = textarea.value;
    const beforeCursor = value.slice(0, textarea.selectionStart);
    const lastAtIndex = beforeCursor.lastIndexOf("@");

    if (lastAtIndex === -1) return;

    const textBeforeAt = value.slice(0, lastAtIndex);

    // Create a temporary element to measure text position
    const mirror = document.createElement("div");
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.font = window.getComputedStyle(textarea).font;
    mirror.style.padding = window.getComputedStyle(textarea).padding;
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.textContent = `${textBeforeAt}@`;

    document.body.appendChild(mirror);
    document.body.removeChild(mirror);

    const textareaRect = textarea.getBoundingClientRect();
    const aiChatContainer = textarea.closest(".ai-chat-container");
    const containerRect = aiChatContainer?.getBoundingClientRect();

    const position = {
      top: textareaRect.top - 240, // Position above the input area (above Context button)
      left: containerRect ? containerRect.left : textareaRect.left, // Position at the left edge of the sidebar
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        const textBeforeAt = value.slice(0, lastAtIndex);

        // Create a temporary element to measure text position
        const mirror = document.createElement("div");
        mirror.style.position = "absolute";
        mirror.style.visibility = "hidden";
        mirror.style.whiteSpace = "pre-wrap";
        mirror.style.font = window.getComputedStyle(textarea).font;
        mirror.style.padding = window.getComputedStyle(textarea).padding;
        mirror.style.width = `${textarea.clientWidth}px`;
        mirror.textContent = `${textBeforeAt}@`;

        document.body.appendChild(mirror);
        document.body.removeChild(mirror);

        const textareaRect = textarea.getBoundingClientRect();
        // Get the AI chat container to position relative to it
        const aiChatContainer = textarea.closest(".ai-chat-container");
        const containerRect = aiChatContainer?.getBoundingClientRect();

        const position = {
          top: textareaRect.top - 240, // Position above the input area (above Context button)
          left: containerRect ? containerRect.left : textareaRect.left, // Position at the left edge of the sidebar
        };

        showMention(position, afterAt, lastAtIndex);
      } else {
        hideMention();
      }
    } else {
      hideMention();
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

  const handleSendMessage = async () => {
    if (!input.trim() || !hasApiKey) return;

    // Trigger send animation
    setIsSendAnimating(true);

    // Reset animation after the flying animation completes
    setTimeout(() => setIsSendAnimating(false), 800);

    await onSendMessage();
  };

  const { estimatedTokens, maxTokens } = calculateTokens;

  return (
    <div
      ref={aiChatContainerRef}
      style={{
        background: "var(--secondary-bg)",
        borderTop: "1px solid var(--border-color)",
      }}
    >
      {/* Model Provider Selector and Mode Toggle */}
      {aiProviderId !== "claude-code" && (
        <div className="px-2 py-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Context Selector Dropdown */}
              <div className="relative" ref={contextDropdownRef}>
                <button
                  onClick={() => setIsContextDropdownOpen(!isContextDropdownOpen)}
                  className="flex items-center gap-1 rounded px-2 pt-2 transition-colors hover:bg-hover"
                  style={{ color: "var(--text-lighter)" }}
                  title="Add context files"
                >
                  <FileText size={12} />
                  <span>Context ({selectedBufferIds.size})</span>
                  <ChevronDown size={10} />
                </button>

                {isContextDropdownOpen && (
                  <div
                    className="absolute top-full left-0 z-50 mt-1 max-h-64 w-64 overflow-y-auto rounded shadow-lg"
                    style={{
                      background: "var(--primary-bg)",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    <div className="p-2">
                      <div className="mb-2 text-xs" style={{ color: "var(--text-lighter)" }}>
                        Select files to include as context:
                      </div>
                      {buffers.length === 0 ? (
                        <div className="p-2 text-xs" style={{ color: "var(--text-lighter)" }}>
                          No files available
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {buffers.map(buffer => (
                            <label
                              key={buffer.id}
                              className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-hover"
                            >
                              <input
                                type="checkbox"
                                checked={selectedBufferIds.has(buffer.id)}
                                onChange={() => toggleBufferSelection(buffer.id)}
                                className="h-3 w-3"
                              />
                              <div className="flex min-w-0 flex-1 items-center gap-1">
                                {buffer.isSQLite ? <Database size={10} /> : <FileText size={10} />}
                                <span className="truncate text-xs">{buffer.name}</span>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Context badges */}
      {aiProviderId !== "claude-code" && selectedBufferIds.size > 0 && (
        <div className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {Array.from(selectedBufferIds).map(bufferId => {
              const buffer = buffers.find(b => b.id === bufferId);
              if (!buffer) return null;
              return (
                <div
                  key={bufferId}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs"
                  style={{
                    background: "var(--hover-color)",
                    border: "1px solid var(--border-color)",
                  }}
                >
                  {buffer.isSQLite ? <Database size={8} /> : <FileText size={8} />}
                  <span className="max-w-20 truncate">{buffer.name}</span>
                  <button
                    onClick={() => toggleBufferSelection(bufferId)}
                    className="transition-colors hover:text-red-400"
                    style={{ color: "var(--text-lighter)" }}
                  >
                    <X size={8} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="p-3">
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
            className="min-h-[60px] flex-1 resize-none rounded px-3 py-2 focus:outline-none disabled:opacity-50"
            style={{
              background: "var(--primary-bg)",
              border: "1px solid var(--border-color)",
              color: "var(--text-color)",
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="hidden sm:block" style={{ color: "var(--text-lighter)" }}>
            <span
              className={
                estimatedTokens > maxTokens * 0.8
                  ? "text-orange-400"
                  : estimatedTokens > maxTokens * 0.9
                    ? "text-red-400"
                    : ""
              }
            >
              {estimatedTokens.toLocaleString()}/{(maxTokens / 1000).toFixed(0)}k tokens
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
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
            <div className="flex items-center gap-1">
              <Button
                type="submit"
                disabled={(!input.trim() && !isTyping) || !hasApiKey}
                onClick={isTyping && streamingMessageId ? onStopStreaming : handleSendMessage}
                className={cn(
                  "flex items-center justify-center rounded p-0",
                  "send-button-hover button-transition",
                  isTyping && streamingMessageId && !isSendAnimating && "button-morphing",
                )}
                style={{
                  color:
                    isTyping && streamingMessageId
                      ? "rgb(59, 130, 246)"
                      : input.trim() && !isTyping && hasApiKey
                        ? "white"
                        : "var(--text-lighter)",
                  border:
                    isTyping && streamingMessageId
                      ? "1px solid rgba(59, 130, 246, 0.3)"
                      : "1px solid transparent",
                  cursor: (!input.trim() && !isTyping) || !hasApiKey ? "not-allowed" : "pointer",
                }}
                title={isTyping && streamingMessageId ? "Stop generation" : "Send message"}
              >
                {isTyping && streamingMessageId && !isSendAnimating ? (
                  <Square size={10} className="transition-all duration-300" />
                ) : (
                  <Send
                    size={10}
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
      </div>

      {/* File Mention Dropdown */}
      {mentionState.active && (
        <FileMentionDropdown
          files={allProjectFiles}
          onSelect={handleFileMentionSelect}
          rootFolderPath={rootFolderPath}
        />
      )}
    </div>
  );
}
