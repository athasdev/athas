import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getAvailableProviders, getModelById } from "@/features/ai/types/providers";
import { cn } from "@/utils/cn";

interface SearchableModelDropdownProps {
  currentProviderId: string;
  currentModelId: string;
  onModelChange: (providerId: string, modelId: string) => void;
  compact?: boolean;
}

export function SearchableModelDropdown({
  currentProviderId,
  currentModelId,
  onModelChange,
  compact = false,
}: SearchableModelDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const currentModel = getModelById(currentProviderId, currentModelId);

  // Flatten all models with provider info
  const allModels = getAvailableProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.id,
      modelName: model.name,
      maxTokens: model.maxTokens,
    })),
  );

  // Filter models based on search
  const filteredModels = search
    ? allModels.filter(
        (m) =>
          m.modelName.toLowerCase().includes(search.toLowerCase()) ||
          m.providerName.toLowerCase().includes(search.toLowerCase()),
      )
    : allModels;

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredModels.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = filteredModels[selectedIndex];
      if (selected) {
        onModelChange(selected.providerId, selected.modelId);
        setIsOpen(false);
        setSearch("");
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setSearch("");
    }
  };

  // Reset selected index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}k`;
    return tokens.toString();
  };

  const handleModelSelect = (providerId: string, modelId: string) => {
    onModelChange(providerId, modelId);
    setIsOpen(false);
    setSearch("");
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "ui-font flex items-center gap-1 rounded bg-transparent px-2 py-1 text-xs transition-colors hover:bg-hover",
          compact ? "min-w-[120px]" : "min-w-[160px]",
        )}
      >
        <div className="min-w-0 flex-1 truncate text-left text-text">
          {currentModel?.name || "Select Model"}
        </div>
        <ChevronDown
          size={10}
          className={cn(
            "shrink-0 text-text-lighter transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          <div
            className="absolute top-full left-0 z-[10000] mt-1 w-[320px] rounded border border-border bg-primary-bg shadow-xl"
            onKeyDown={handleKeyDown}
          >
            {/* Search Input */}
            <div className="flex items-center gap-2 border-border border-b px-2 py-1.5">
              <Search size={12} className="text-text-lighter" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="search models..."
                className="ui-font flex-1 border-none bg-transparent text-text text-xs outline-none placeholder:text-text-lighter"
              />
            </div>

            {/* Models List */}
            <div className="max-h-[300px] overflow-y-auto">
              {filteredModels.length === 0 ? (
                <div className="px-3 py-2 text-center text-text-lighter text-xs">
                  No models found
                </div>
              ) : (
                filteredModels.map((model, index) => {
                  const isSelected =
                    model.providerId === currentProviderId && model.modelId === currentModelId;
                  const isHighlighted = index === selectedIndex;

                  return (
                    <div
                      key={`${model.providerId}-${model.modelId}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 border-border border-b px-3 py-1.5 last:border-b-0",
                        isSelected && "bg-hover",
                        isHighlighted && "bg-secondary-bg",
                      )}
                      onClick={() => handleModelSelect(model.providerId, model.modelId)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="ui-font truncate text-text text-xs">
                            {model.modelName}
                          </span>
                          {isSelected && <Check size={10} className="shrink-0 text-text-lighter" />}
                        </div>
                        <div className="ui-font truncate text-[10px] text-text-lighter">
                          {model.providerName}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="ui-font text-[10px] text-text-lighter">
                          {formatTokens(model.maxTokens)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Click Outside to Close */}
          <div className="fixed inset-0 z-[9999]" onClick={() => setIsOpen(false)} />
        </>
      )}
    </div>
  );
}
