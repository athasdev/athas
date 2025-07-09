import { Bot, Check, ChevronDown, Key } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { AI_PROVIDERS, getModelById, getProviderById } from "../types/ai-provider";
import { cn } from "../utils/cn";

interface ModelProviderSelectorProps {
  currentProviderId: string;
  currentModelId: string;
  onProviderChange: (providerId: string, modelId: string) => void;
  onApiKeyRequest: (providerId: string) => void;
  hasApiKey: (providerId: string) => boolean;
}

const ModelProviderSelector = ({
  currentProviderId,
  currentModelId,
  onProviderChange,
  onApiKeyRequest,
  hasApiKey,
}: ModelProviderSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState(currentProviderId);

  const currentModel = getModelById(currentProviderId, currentModelId);

  const handleProviderSelect = (providerId: string) => {
    setSelectedProviderId(providerId);
    const provider = getProviderById(providerId);
    if (provider && provider.models.length > 0) {
      // Auto-select the first model for the new provider
      const firstModel = provider.models[0];
      onProviderChange(providerId, firstModel.id);
      setIsOpen(false);
    }
  };

  const handleModelSelect = (modelId: string) => {
    onProviderChange(selectedProviderId, modelId);
    setIsOpen(false);
  };

  const handleApiKeyClick = (e: React.MouseEvent, providerId: string) => {
    e.stopPropagation();
    onApiKeyRequest(providerId);
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}k`;
    return tokens.toString();
  };

  return (
    <div className="relative">
      {/* Current Selection Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded text-xs font-mono hover:bg-[var(--hover-color)] transition-colors min-w-[160px]"
      >
        <Bot size={10} className="text-[var(--text-lighter)]" />
        <div className="flex-1 text-left min-w-0">
          <div className="text-[var(--text-color)] truncate text-xs">
            {currentModel?.name || "Select Model"}
          </div>
        </div>
        <ChevronDown
          size={10}
          className={cn(
            "text-[var(--text-lighter)] transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg shadow-xl z-[9999] min-w-[360px] max-h-[80vh] overflow-y-auto">
          {AI_PROVIDERS.map(provider => (
            <div
              key={provider.id}
              className="border-b border-[var(--border-color)] last:border-b-0"
            >
              {/* Provider Header */}
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors",
                  selectedProviderId === provider.id
                    ? "bg-blue-500/10 border-blue-500/20"
                    : "hover:bg-[var(--hover-color)]",
                )}
                onClick={() => handleProviderSelect(provider.id)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-xs text-[var(--text-color)]">
                      {provider.name}
                    </div>
                    {selectedProviderId === provider.id && (
                      <Check size={10} className="text-blue-400" />
                    )}
                  </div>
                </div>

                {/* API Key Status */}
                {provider.requiresApiKey ? (
                  <button
                    onClick={e => handleApiKeyClick(e, provider.id)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                      hasApiKey(provider.id)
                        ? "bg-green-500/20 text-green-400 border border-green-500/30"
                        : "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30",
                    )}
                  >
                    <Key size={10} />
                    {hasApiKey(provider.id) ? "Key Set" : "Set Key"}
                  </button>
                ) : (
                  <div className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    ✓ Ready
                  </div>
                )}
              </div>

              {/* Models List */}
              {selectedProviderId === provider.id && (
                <div className="bg-[var(--secondary-bg)] border-t border-[var(--border-color)]">
                  {provider.models.map(model => (
                    <div
                      key={model.id}
                      className={cn(
                        "flex items-center gap-2 px-4 py-1.5 cursor-pointer transition-colors",
                        currentModelId === model.id && currentProviderId === provider.id
                          ? "bg-blue-500/20 border-blue-500/30"
                          : "hover:bg-[var(--hover-color)]",
                      )}
                      onClick={() => handleModelSelect(model.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-xs text-[var(--text-color)] truncate">
                            {model.name}
                          </div>
                          {currentModelId === model.id && currentProviderId === provider.id && (
                            <Check size={8} className="text-blue-400 flex-shrink-0" />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[var(--text-lighter)] flex-shrink-0">
                        <span>{formatTokens(model.maxTokens)}</span>
                        {model.costPer1kTokens !== undefined && (
                          <span>
                            ${model.costPer1kTokens === 0 ? "Free" : model.costPer1kTokens}
                            /1k
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Click Outside to Close */}
      {isOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/20" onClick={() => setIsOpen(false)} />
      )}
    </div>
  );
};

export default ModelProviderSelector;
