import { Bot, Brain, Check, ChevronDown, Compass, Cpu, Globe, Rocket } from "lucide-react";
import type { RefObject } from "react";
import { useMemo, useRef, useState } from "react";
import { useOnClickOutside } from "usehooks-ts";
import type { AutocompleteModel } from "@/utils/autocomplete";
import { cn } from "@/utils/cn";

interface InlineEditModelSelectorProps {
  models: AutocompleteModel[];
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
}

const getProviderFromModelId = (modelId: string): string => {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex <= 0) return "default";
  return modelId.slice(0, slashIndex).toLowerCase();
};

const ProviderIcon = ({ providerId, className }: { providerId: string; className?: string }) => {
  switch (providerId) {
    case "openai":
      return <Bot size={11} className={className} />;
    case "anthropic":
      return <Brain size={11} className={className} />;
    case "google":
      return <Globe size={11} className={className} />;
    case "xai":
      return <Rocket size={11} className={className} />;
    case "deepseek":
      return <Compass size={11} className={className} />;
    default:
      return <Cpu size={11} className={className} />;
  }
};

export const InlineEditModelSelector = ({
  models,
  value,
  onChange,
  disabled = false,
  isLoading = false,
}: InlineEditModelSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useOnClickOutside(rootRef as RefObject<HTMLElement>, () => setIsOpen(false));

  const selectedModel = useMemo(
    () => models.find((model) => model.id === value) ?? null,
    [models, value],
  );

  const selectedLabel = selectedModel?.name || value;
  const selectedProviderId = getProviderFromModelId(selectedModel?.id || value);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        className={cn(
          "ui-font flex h-8 max-w-[150px] items-center gap-1 rounded-lg border border-border bg-secondary-bg/70 px-2 text-text text-xs",
          "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60",
        )}
        aria-label="Inline edit model selector"
      >
        <ProviderIcon providerId={selectedProviderId} className="shrink-0 text-text-lighter" />
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          size={10}
          className={cn("shrink-0 text-text-lighter transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 bottom-full z-[230] mb-1 max-h-64 w-[240px] overflow-y-auto rounded-2xl border border-border bg-primary-bg/95 p-1 backdrop-blur-sm">
          {isLoading ? (
            <div className="px-2 py-3 text-center text-text-lighter text-xs">Loading models...</div>
          ) : models.length === 0 ? (
            <div className="px-2 py-3 text-center text-text-lighter text-xs">
              No models available
            </div>
          ) : (
            models.map((model) => {
              const isActive = model.id === value;
              const providerId = getProviderFromModelId(model.id);

              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onChange(model.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "ui-font flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                    isActive ? "bg-selected text-text" : "text-text hover:bg-hover",
                  )}
                >
                  <ProviderIcon providerId={providerId} className="shrink-0 text-text-lighter" />
                  <span className="min-w-0 flex-1 truncate">{model.name}</span>
                  {isActive && <Check size={10} className="shrink-0 text-accent" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
