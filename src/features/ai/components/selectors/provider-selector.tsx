import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import {
  useAvailableProviders,
  useProviderById,
} from "@/features/ai/hooks/use-available-providers";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";

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
            className="shrink-0 text-subtle-foreground"
          />
        ),
      }))}
      placeholder={currentProvider?.name || providerId || "Select provider"}
      aria-label="Select AI provider"
      searchable
      searchableTrigger={isComposer ? "input" : "menu"}
      hideChevron={isComposer}
      size="xs"
      variant={isComposer ? "ghost" : "default"}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      tooltip={tooltip}
      className={cn(!isComposer && "w-fit max-w-full", className)}
      triggerClassName={cn(isComposer ? "max-w-32" : "w-fit max-w-full gap-2", triggerClassName)}
      menuClassName="w-fit min-w-0 max-w-(--available-width) p-0"
      menuMinWidth={isComposer ? 220 : 0}
      menuAnimated={!isComposer}
    />
  );
}
