import { useMemo } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import type { AutocompleteModel } from "@/features/editor/services/editor-autocomplete-service";
import Select from "@/ui/select";

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

  return (
    <Select
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled || isLoading}
      menuClassName="inline-edit-model-selector-menu w-[240px] backdrop-blur-none"
      className="max-w-[170px] border-none px-2 text-text"
      size="xs"
      openDirection="auto"
      placeholder={isLoading ? "Loading models..." : "Select model"}
      aria-label="Inline edit model"
    />
  );
};
