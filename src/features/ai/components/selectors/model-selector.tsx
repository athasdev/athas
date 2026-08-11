import { LockIcon as Lock, WarningCircleIcon as WarningCircle } from "@/ui/icons";
import { useAIModelOptions } from "@/features/ai/hooks/use-ai-model-options";
import { ProBadge } from "@/extensions/ui/components/pro-badge";
import { Alert, AlertDescription } from "@/ui/alert";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";

interface ModelSelectorProps {
  providerId: string;
  modelId: string;
  onChange: (modelId: string) => void;
  appearance?: "settings" | "composer";
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
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
  triggerClassName,
  open,
  onOpenChange,
  tooltip,
}: ModelSelectorProps) {
  const isComposer = appearance === "composer";
  const { availableModels, currentModelName, hasHostedAi, isCustomProvider, modelFetchError } =
    useAIModelOptions(providerId, modelId, onChange);

  return (
    <Select
      value={modelId}
      onChange={onChange}
      options={availableModels.map((model) => {
        const locked = Boolean(model.proOnly && !hasHostedAi);
        return {
          value: model.id,
          label: model.name,
          keywords: [model.id],
          disabled: locked,
          icon: locked ? <Lock className="text-subtle-foreground" /> : undefined,
          accessory: model.proOnly ? <ProBadge /> : undefined,
        };
      })}
      placeholder={currentModelName}
      aria-label="Select AI model"
      searchable
      searchableTrigger={isComposer ? "input" : "menu"}
      openDirection={isComposer ? "up" : "down"}
      allowCustomValue={isCustomProvider}
      customValueLabel={(customValue) => `Use ${customValue}`}
      emptyLabel={isCustomProvider ? "Type a model name and press Enter" : "No models found"}
      hideChevron={isComposer}
      size="xs"
      variant={isComposer ? "ghost" : "default"}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      tooltip={tooltip}
      className={cn(!isComposer && "w-fit max-w-full", className)}
      triggerClassName={cn(isComposer ? "max-w-44" : "w-fit max-w-full", triggerClassName)}
      menuClassName="w-fit min-w-0 max-w-(--available-width) p-0"
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
