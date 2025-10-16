import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SearchableModelDropdown } from "@/components/primitives/searchable-model-dropdown";
import { useToast } from "@/contexts/toast-context";
import { useAIChatStore } from "@/stores/ai-chat/store";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";

interface InlineEditToolbarProps {
  visible: boolean;
  position: { x: number; y: number };
  onPromptSubmit: (prompt: string, providerId: string, modelId: string) => void;
  onClose: () => void;
}

export function InlineEditToolbar({
  visible,
  position,
  onPromptSubmit,
  onClose,
}: InlineEditToolbarProps) {
  const [prompt, setPrompt] = useState("");
  const [currentProviderId, setCurrentProviderId] = useState("anthropic");
  const [currentModelId, setCurrentModelId] = useState("claude-sonnet-4");
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { hasProviderApiKey } = useAIChatStore();
  const { showToast } = useToast();
  const { openSettingsDialog } = useUIState();

  // Focus input when visible
  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && visible) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [visible, onClose]);

  const handleSubmit = () => {
    if (!prompt.trim() || isProcessing) return;

    // Check if API key is required and available
    const provider = currentProviderId;
    if (provider !== "claude-code" && !hasProviderApiKey(provider)) {
      showToast({
        message: "API key required for this provider",
        type: "error",
        duration: 5000,
        action: {
          label: "Configure",
          onClick: () => {
            openSettingsDialog("ai");
            onClose();
          },
        },
      });
      return;
    }

    setIsProcessing(true);

    try {
      onPromptSubmit(prompt, currentProviderId, currentModelId);
      setPrompt("");
      showToast({
        message: "Processing edit request...",
        type: "info",
        duration: 3000,
      });
    } catch (err) {
      showToast({
        message: err instanceof Error ? err.message : "Failed to process request",
        type: "error",
        duration: 5000,
      });
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleModelChange = (providerId: string, modelId: string) => {
    setCurrentProviderId(providerId);
    setCurrentModelId(modelId);
  };

  // Reset state when visibility changes
  useEffect(() => {
    if (!visible) {
      setIsProcessing(false);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[9997]" onClick={onClose} />

      {/* Toolbar */}
      <div
        className={cn(
          "fixed z-[9998] flex flex-col gap-1 rounded border border-border bg-primary-bg/95 backdrop-blur-sm",
          "p-1.5 shadow-lg",
        )}
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: "translateY(-100%)",
          marginTop: "-8px",
        }}
      >
        {/* First row - Input (main focus) */}
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Edit instruction..."
            disabled={isProcessing}
            className={cn(
              "w-[320px] flex-1 border-none bg-transparent px-0.5 py-1 font-mono text-sm text-text outline-none placeholder:text-text-lighter",
              isProcessing && "opacity-50",
            )}
          />
          {isProcessing && <Loader2 size={14} className="animate-spin text-text-lighter" />}
        </div>

        {/* Second row - Model selector and action button */}
        <div className="flex items-center justify-between gap-2 border-border border-t pt-1">
          <SearchableModelDropdown
            currentProviderId={currentProviderId}
            currentModelId={currentModelId}
            onModelChange={handleModelChange}
            compact
          />
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || isProcessing}
            className={cn(
              "flex-shrink-0 rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
              prompt.trim() && !isProcessing
                ? "bg-hover text-text hover:bg-border"
                : "cursor-not-allowed text-text-lighter opacity-50",
            )}
          >
            {isProcessing ? "..." : "Run"}
          </button>
        </div>
      </div>
    </>
  );
}
