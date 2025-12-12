import { Check, ChevronDown, Key, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAvailableProviders } from "@/features/ai/types/providers";
import { cn } from "@/utils/cn";

interface ModelSelectorDropdownProps {
  currentProviderId: string;
  currentModelId: string;
  currentModelName: string;
  onSelect: (providerId: string, modelId: string) => void;
  onOpenSettings: () => void;
  hasApiKey: (providerId: string) => boolean;
}

export function ModelSelectorDropdown({
  currentProviderId,
  currentModelId,
  currentModelName,
  onSelect,
  onOpenSettings,
  hasApiKey,
}: ModelSelectorDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const providers = getAvailableProviders();

  const filteredItems = useMemo(() => {
    const items: Array<{
      type: "provider" | "model";
      providerId: string;
      providerName: string;
      modelId?: string;
      modelName?: string;
      requiresApiKey?: boolean;
      hasKey?: boolean;
    }> = [];

    const searchLower = search.toLowerCase();

    for (const provider of providers) {
      const providerMatches = provider.name.toLowerCase().includes(searchLower);
      const providerHasKey = !provider.requiresApiKey || hasApiKey(provider.id);
      const matchingModels = provider.models.filter(
        (model) =>
          providerMatches ||
          model.name.toLowerCase().includes(searchLower) ||
          model.id.toLowerCase().includes(searchLower),
      );

      if (matchingModels.length > 0 || (providerMatches && search === "")) {
        items.push({
          type: "provider",
          providerId: provider.id,
          providerName: provider.name,
          requiresApiKey: provider.requiresApiKey,
          hasKey: providerHasKey,
        });

        // Only show models if provider has API key or doesn't require one
        if (providerHasKey) {
          const modelsToShow = search ? matchingModels : provider.models;
          for (const model of modelsToShow) {
            items.push({
              type: "model",
              providerId: provider.id,
              providerName: provider.name,
              modelId: model.id,
              modelName: model.name,
            });
          }
        }
      }
    }

    return items;
  }, [providers, search, hasApiKey]);

  const selectableItems = useMemo(
    () => filteredItems.filter((item) => item.type === "model"),
    [filteredItems],
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, selectableItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (selectableItems[selectedIndex]) {
            const item = selectableItems[selectedIndex];
            onSelect(item.providerId, item.modelId!);
            setIsOpen(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [isOpen, selectableItems, selectedIndex, onSelect],
  );

  const handleApiKeyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenSettings();
    setIsOpen(false);
  };

  let selectableIndex = -1;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className="ui-font flex items-center gap-1 rounded bg-transparent px-2 py-1 text-xs transition-colors hover:bg-hover"
      >
        <span className="max-w-[120px] truncate text-text-lighter">{currentModelName}</span>
        <ChevronDown
          size={12}
          className={cn("text-text-lighter transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setIsOpen(false)} />
          <div
            ref={dropdownRef}
            onKeyDown={handleKeyDown}
            className={cn(
              "absolute bottom-full left-0 z-[9999] mb-1",
              "max-h-[400px] min-w-[280px] overflow-hidden",
              "rounded-lg border border-border bg-primary-bg shadow-xl",
            )}
          >
            <div className="border-border border-b p-2">
              <div className="flex items-center gap-2 rounded bg-secondary-bg px-2 py-1.5">
                <Search size={12} className="text-text-lighter" />
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search models..."
                  className="flex-1 bg-transparent text-text text-xs outline-none placeholder:text-text-lighter"
                />
              </div>
            </div>

            <div className="max-h-[340px] overflow-y-auto p-1">
              {filteredItems.length === 0 ? (
                <div className="p-4 text-center text-text-lighter text-xs">No models found</div>
              ) : (
                filteredItems.map((item) => {
                  if (item.type === "provider") {
                    return (
                      <div
                        key={`provider-${item.providerId}`}
                        className="flex items-center justify-between px-2 py-1.5"
                      >
                        <span className="font-medium text-text-lighter text-xs">
                          {item.providerName}
                        </span>
                        {item.requiresApiKey && !item.hasKey && (
                          <button
                            onClick={handleApiKeyClick}
                            className="flex items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400 transition-colors hover:bg-red-500/30"
                          >
                            <Key size={8} />
                            Set Key
                          </button>
                        )}
                      </div>
                    );
                  }

                  selectableIndex++;
                  const isSelected = selectableIndex === selectedIndex;
                  const isCurrent =
                    item.providerId === currentProviderId && item.modelId === currentModelId;

                  return (
                    <button
                      key={`model-${item.providerId}-${item.modelId}`}
                      onClick={() => {
                        onSelect(item.providerId, item.modelId!);
                        setIsOpen(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(selectableIndex)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-3 py-1.5 text-left transition-colors",
                        isSelected ? "bg-hover" : "bg-transparent",
                        isCurrent && "bg-accent/10",
                      )}
                    >
                      <span className="flex-1 truncate text-text text-xs">{item.modelName}</span>
                      {isCurrent && <Check size={10} className="text-accent" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
