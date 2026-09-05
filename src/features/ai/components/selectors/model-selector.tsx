import { WarningCircleIcon as WarningCircle } from "@/ui/icons";
import { useAIModelOptions } from "@/features/ai/hooks/use-ai-model-options";
import { Alert, AlertDescription } from "@/ui/alert";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import { ProviderIcon } from "../icons/provider-icons";

interface ModelSelectorProps {
  providerId: string;
  modelId: string;
  onChange: (modelId: string) => void;
  appearance?: "settings" | "composer";
  disabled?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tooltip?: string;
}

export function ModelSelector({
  providerId,
  modelId,
  onChange,
  appearance = "settings",
  disabled,
  className,
  open,
  onOpenChange,
  tooltip,
}: ModelSelectorProps) {
  const isComposer = appearance === "composer";
  const { availableModels, currentModelName, isCustomProvider, isLoadingModels, modelFetchError } =
    useAIModelOptions(providerId, modelId, onChange);

  return (
    <Select
      value={modelId}
      onChange={onChange}
      options={availableModels.map((model) => {
        return {
          value: model.id,
          label: model.name,
          keywords: [model.id],
        };
      })}
      placeholder={currentModelName}
      aria-label="Change model"
      searchable
      searchableTrigger="menu"
      openDirection={isComposer ? "up" : "down"}
      allowCustomValue={isCustomProvider || providerId === "openrouter"}
      customValueLabel={(customValue) => `Use ${customValue}`}
      emptyLabel={
        isLoadingModels
          ? "Loading models…"
          : isCustomProvider
            ? "Type a model name and press Enter"
            : "No models found"
      }
      leftIcon={isComposer ? <ProviderIcon providerId={providerId} /> : undefined}
      variant={isComposer ? "ghost" : "default"}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      tooltip={tooltip}
      className={cn(isComposer ? "w-fit max-w-44" : "w-fit max-w-full", className)}
      menuWidth="content"
      menuMinWidth={isComposer ? 260 : 0}
      menuAnimated={!isComposer}
      menuHeader={
        modelFetchError ? (
          <Alert tone="warning" role="status" className="m-1 w-auto">
            <WarningCircle />
            <AlertDescription>{modelFetchError}</AlertDescription>
          </Alert>
        ) : undefined
      }
    />
  );
}
