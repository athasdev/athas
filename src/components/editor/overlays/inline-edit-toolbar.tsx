import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SearchableModelDropdown } from "@/components/primitives/searchable-model-dropdown";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { useToast } from "@/contexts/toast-context";
import { useAIChatStore } from "@/stores/ai-chat/store";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";
import { useOverlayManager } from "./overlay-manager";

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
  const { showOverlay, hideOverlay, shouldShowOverlay } = useOverlayManager();

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
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleModelChange = (providerId: string, modelId: string) => {
    setCurrentProviderId(providerId);
    setCurrentModelId(modelId);
  };

  // Register/unregister with overlay manager
  useEffect(() => {
    if (visible) {
      showOverlay("inline-toolbar");
    } else {
      hideOverlay("inline-toolbar");
    }
  }, [visible, showOverlay, hideOverlay]);

  // Reset state when visibility changes
  useEffect(() => {
    if (!visible) {
      setIsProcessing(false);
    }
  }, [visible]);

  // Check if this overlay should be shown
  const shouldShow = shouldShowOverlay("inline-toolbar");

  if (!visible || !shouldShow) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[9997]" onClick={onClose} />

      {/* Toolbar */}
      <div
        className={cn(
          "fixed flex flex-col gap-2 rounded border border-border bg-primary-bg/95 backdrop-blur-sm",
          "p-2 shadow-lg",
        )}
        style={{
          zIndex: EDITOR_CONSTANTS.Z_INDEX.INLINE_TOOLBAR,
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: "translateY(-100%)",
          marginTop: "-8px",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Input row */}
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
              "w-[320px] flex-1 border-none bg-transparent px-1 py-1.5 font-mono text-xs text-text outline-none placeholder:text-text-lighter",
              isProcessing && "opacity-50",
            )}
          />
          {isProcessing && <Loader2 size={12} className="animate-spin text-text-lighter" />}
        </div>

        {/* Model selector and action button row - no divider */}
        <div className="flex items-center justify-between gap-2">
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
              "flex items-center gap-1 flex-shrink-0 rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
              prompt.trim() && !isProcessing
                ? "bg-hover text-text hover:bg-border"
                : "cursor-not-allowed text-text-lighter opacity-50",
            )}
            title="Run (⌘+Enter)"
          >
            {isProcessing ? "..." : "Run"}
          </button>
        </div>
      </div>
    </>
  );
}
