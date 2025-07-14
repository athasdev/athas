import { Bot, Check, ChevronDown, Key } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { AI_PROVIDERS, getModelById } from "../types/ai-provider";
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
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const currentModel = getModelById(currentProviderId, currentModelId);

  const handleProviderSelect = (providerId: string) => {
    setSelectedProviderId(providerId);
  };

  const handleModelSelectAndClose = (providerId: string, modelId: string) => {
    onProviderChange(providerId, modelId);
    setIsOpen(false);
  };

  const handleModelSelect = (modelId: string) => {
    handleModelSelectAndClose(selectedProviderId, modelId);
  };

  const handleApiKeyClick = (e: React.MouseEvent, providerId: string) => {
    e.stopPropagation();
    onApiKeyRequest(providerId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
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
        className="flex min-w-[160px] items-center gap-1.5 rounded border border-border bg-secondary-bg px-2 py-1 font-mono text-xs transition-colors hover:bg-hover"
      >
        <Bot size={10} className="text-text-lighter" />
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-text text-xs">{currentModel?.name || "Select Model"}</div>
        </div>
        <ChevronDown
          size={10}
          className={cn(
            "text-text-lighter transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[9999] max-h-[80vh] min-w-[480px] transform overflow-y-auto rounded-lg border border-border bg-primary-bg shadow-xl">
          {AI_PROVIDERS.map(provider => (
            <div key={provider.id} className="border-border border-b last:border-b-0">
              {/* Provider Header */}
              <div
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors",
                  selectedProviderId === provider.id
                    ? "border-blue-500/20 bg-blue-500/10"
                    : "hover:bg-hover",
                )}
                onClick={() => handleProviderSelect(provider.id)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-text text-xs">{provider.name}</div>
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
                      "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                      hasApiKey(provider.id)
                        ? "border border-border bg-secondary-bg text-text-lighter hover:bg-hover"
                        : "border border-red-500/30 bg-red-500/20 text-red-400 hover:bg-red-500/30",
                    )}
                  >
                    <Key size={10} />
                    {hasApiKey(provider.id) ? "Key Set" : "Set Key"}
                  </button>
                ) : (
                  <div className="flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/20 px-2 py-1 text-blue-400 text-xs">
                    ✓ Ready
                  </div>
                )}
              </div>

              {/* Models List */}
              {selectedProviderId === provider.id && (
                <div className="border-border border-t bg-secondary-bg">
                  {provider.models.map(model => (
                    <div
                      key={model.id}
                      className={cn(
                        "relative flex cursor-pointer items-center gap-2 px-4 py-1.5 transition-colors",
                        currentModelId === model.id && currentProviderId === provider.id
                          ? "border-blue-500/30 bg-blue-500/20"
                          : "hover:bg-hover",
                      )}
                      onClick={() => handleModelSelect(model.id)}
                      onMouseEnter={() => setHoveredModel(model.id)}
                      onMouseLeave={() => setHoveredModel(null)}
                      onMouseMove={handleMouseMove}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-medium text-text text-xs">{model.name}</div>
                          {currentModelId === model.id && currentProviderId === provider.id && (
                            <Check size={8} className="flex-shrink-0 text-blue-400" />
                          )}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2 text-text-lighter text-xs">
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

      {/* Floating Tooltip */}
      {hoveredModel &&
        isOpen &&
        (() => {
          const model = AI_PROVIDERS.flatMap(p => p.models).find(m => m.id === hoveredModel);
          return model?.description ? (
            <div
              className="pointer-events-none fixed z-[10000] max-w-xs rounded border border-border bg-primary-bg px-2 py-1 shadow-lg"
              style={{
                left: mousePos.x + 10,
                top: mousePos.y - 30,
              }}
            >
              <div className="text-text text-xs">{model.description}</div>
            </div>
          ) : null;
        })()}
    </div>
  );
};

export default ModelProviderSelector;
