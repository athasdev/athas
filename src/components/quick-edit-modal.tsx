import { Loader2, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../stores/app-store";
import { useBufferStore } from "../stores/buffer-store";
import { usePersistentSettingsStore } from "../stores/persistent-settings-store";
import { AI_PROVIDERS, getModelById } from "../types/ai-provider";
import { getProviderApiToken } from "../utils/ai-chat";
import { getFilenameFromPath, getLanguageFromFilename } from "../utils/file-utils";
import ModelProviderSelector from "./model-provider-selector";

const QuickEditInline = () => {
  // Get data from stores
  const { quickEditState, closeQuickEdit, applyQuickEdit } = useAppStore();
  const { aiProviderId, aiModelId, setAIProviderAndModel } = usePersistentSettingsStore();
  const activeBuffer = useBufferStore(state => state.getActiveBuffer());

  const isOpen = quickEditState.isOpen;
  const onClose = closeQuickEdit;
  const selectedText = quickEditState.selectedText;
  const cursorPosition = quickEditState.cursorPosition;
  const filename = activeBuffer ? getFilenameFromPath(activeBuffer.path) : undefined;
  const language = activeBuffer && filename ? getLanguageFromFilename(filename) : undefined;
  const onApplyEdit = (editedText: string) => {
    applyQuickEdit(editedText);
  };
  const [instruction, setInstruction] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Provider/model state for inline edit
  const providerId = aiProviderId;
  const modelId = aiModelId;
  const setProviderId = (id: string) => setAIProviderAndModel(id, modelId);
  const setModelId = (id: string) => setAIProviderAndModel(providerId, id);

  useEffect(() => {
    if (isOpen) {
      setInstruction("");
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    // Position the component near the cursor
    if (isOpen && containerRef.current) {
      const container = containerRef.current;
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      };

      let left = cursorPosition.x;
      let top = cursorPosition.y + 12; // Slightly below cursor

      // Adjust if would go off screen
      if (left + 320 > viewport.width) {
        left = viewport.width - 340;
      }
      if (top + 80 > viewport.height) {
        top = cursorPosition.y - 100; // Above cursor instead
      }

      container.style.left = `${Math.max(8, left)}px`;
      container.style.top = `${Math.max(8, top)}px`;
    }
  }, [isOpen, cursorPosition]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  };

  const handleClose = () => {
    setIsStreaming(false);
    onClose();
  };

  const handleProviderChange = (newProviderId: string, newModelId: string) => {
    setProviderId(newProviderId);
    setModelId(newModelId);
    localStorage.setItem("ai-chat-provider", newProviderId);
    localStorage.setItem("ai-chat-model", newModelId);
  };

  const handleEdit = async () => {
    if (!instruction.trim() || isStreaming) return;

    setIsStreaming(true);

    try {
      // Use selected provider/model
      const provider = AI_PROVIDERS.find(p => p.id === providerId);
      const model = provider ? getModelById(provider.id, modelId) : null;

      if (!provider || !model) {
        throw new Error("No AI provider or model configured");
      }

      const apiKey = await getProviderApiToken(provider.id);
      if (!apiKey) {
        throw new Error("API key not found");
      }

      // Use the selected model's id
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.id,
          messages: [
            {
              role: "user",
              content: `Edit this code according to the instruction.

File: ${filename || "unknown"} (${language || "text"})
Instruction: ${instruction}

Current code:
${selectedText}

Return only the edited code, nothing else:`,
            },
          ],
          max_tokens: 1000,
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      const editedText = result.choices[0].message.content.trim();

      if (editedText) {
        onApplyEdit(editedText);
        onClose();
      } else {
        throw new Error("No response from AI");
      }
    } catch (error) {
      console.error("❌ Error during AI edit:", error);
      // TODO: Show error feedback in UI instead of alert
    } finally {
      setIsStreaming(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-50 rounded-md border border-border bg-white shadow-xl"
      style={{
        minWidth: "40%",
        maxWidth: "100%",
        padding: "0.5rem 0.5rem 0.25rem 0.75rem",
        fontSize: "13px",
      }}
    >
      {/* Prompt input */}
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your changes (Enter to run, esc to close)"
          disabled={isStreaming}
          className="flex-1 rounded px-2 py-2 text-text text-xs placeholder-text-lighter outline-none transition-all"
          style={{
            fontSize: "14px",
            minHeight: "2.2em",
            fontWeight: 400,
          }}
        />
        <div className="ml-1 flex flex-shrink-0 items-center gap-1">
          {isStreaming && <Loader2 size={16} className="animate-spin text-text-lighter" />}
          <button
            onClick={handleClose}
            className="p-1 text-text-lighter transition-colors hover:text-text"
            disabled={isStreaming}
            tabIndex={-1}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      {/* Provider/Model Selector - compact */}
      <div className="my-1">
        <ModelProviderSelector
          currentProviderId={providerId}
          currentModelId={modelId}
          onProviderChange={handleProviderChange}
          onApiKeyRequest={() => {}}
          hasApiKey={providerId => !!localStorage.getItem(`ai-chat-api-key-${providerId}`)}
        />
      </div>
    </div>
  );
};

export default QuickEditInline;
