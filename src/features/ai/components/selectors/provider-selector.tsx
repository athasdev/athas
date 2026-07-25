import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import {
  useAvailableProviders,
  useProviderById,
} from "@/features/ai/hooks/use-available-providers";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import {
  chatComposerControlClassName,
  chatComposerDropdownClassName,
  chatSettingsSelectorTriggerClassName,
} from "../input/chat-composer-control-styles";

interface ProviderSelectorProps {
  providerId: string;
  onChange: (providerId: string) => void;
  appearance?: "settings" | "composer";
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tooltip?: string;
}

export function ProviderSelector({
  providerId,
  onChange,
  appearance = "settings",
  disabled,
  className,
  triggerClassName,
  open,
  onOpenChange,
  tooltip,
}: ProviderSelectorProps) {
  const providers = useAvailableProviders();
  const currentProvider = useProviderById(providerId);
  const isComposer = appearance === "composer";
  const iconSize = isComposer ? 12 : 14;

  return (
    <Select
      value={providerId}
      onChange={onChange}
      options={providers.map((provider) => ({
        value: provider.id,
        label: provider.name,
        icon: (
          <ProviderIcon
            providerId={provider.id}
            size={iconSize}
            className="shrink-0 text-text-lighter"
          />
        ),
      }))}
      placeholder={currentProvider?.name || providerId || "Select provider"}
      aria-label="Select AI provider"
      searchable
      searchableTrigger="input"
      hideChevron
      size="xs"
      variant={isComposer ? "ghost" : "default"}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      tooltip={tooltip}
      className={className}
      triggerClassName={cn(
        isComposer
          ? chatComposerControlClassName("max-w-[128px]")
          : chatSettingsSelectorTriggerClassName("w-[220px] gap-2"),
        triggerClassName,
      )}
      menuClassName={
        isComposer
          ? chatComposerDropdownClassName("min-w-0 p-0")
          : "min-w-0 overflow-hidden rounded-xl p-0"
      }
      menuMinWidth={isComposer ? 220 : 0}
      menuAnimated={!isComposer}
    />
  );
}
