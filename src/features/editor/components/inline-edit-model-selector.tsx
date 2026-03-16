import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import type { AutocompleteModel } from "@/features/editor/services/editor-autocomplete-service";
import Select from "@/ui/select";
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

export const InlineEditModelSelector = ({
  models,
  value,
  onChange,
  disabled = false,
  isLoading = false,
}: InlineEditModelSelectorProps) => {
  const selectedModel = useMemo(
    () => models.find((model) => model.id === value) ?? null,
    [models, value],
  );

  const options = useMemo(
    () =>
      models.map((model) => ({
        value: model.id,
        label: model.name,
        icon: (
          <ProviderIcon
            providerId={getProviderFromModelId(model.id)}
            size={11}
            className="text-text-lighter"
          />
        ),
      })),
    [models],
  );

  const selectedLabel = selectedModel?.name || value;
  const selectedProviderId = getProviderFromModelId(selectedModel?.id || value);

  return (
    <Select
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled || isLoading}
      menuClassName="w-[240px]"
      className="max-w-[150px]"
      openDirection="up"
      placeholder={isLoading ? "Loading models..." : "Select model"}
      CustomTrigger={({ ref, onClick }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          disabled={disabled || isLoading}
          className={cn(
            "ui-font flex h-8 max-w-[150px] items-center gap-1 rounded-lg border border-border bg-secondary-bg/70 px-2 text-text text-xs",
            "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60",
          )}
          aria-label="Inline edit model selector"
        >
          <ProviderIcon providerId={selectedProviderId} size={11} className="text-text-lighter" />
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown size={10} className="shrink-0 text-text-lighter" />
        </button>
      )}
    />
  );
};
