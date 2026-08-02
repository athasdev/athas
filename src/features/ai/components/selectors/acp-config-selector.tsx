import type { SessionConfigOption } from "@/features/ai/types/acp.types";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";

interface AcpConfigSelectorProps {
  option: SessionConfigOption;
  onChange: (value: string) => void;
  className?: string;
  menuClassName?: string;
  menuMinWidth?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AcpConfigSelector({
  option,
  onChange,
  className,
  menuClassName,
  menuMinWidth = 180,
  open,
  onOpenChange,
}: AcpConfigSelectorProps) {
  const getCurrentAgentId = useAIChatStore((state) => state.actions.getCurrentAgentId);
  const currentAgentId = getCurrentAgentId();

  if (option.kind.type !== "select" || option.kind.options.length === 0) {
    return null;
  }

  return (
    <Select
      value={option.kind.currentValue || option.kind.options[0]?.id || ""}
      options={option.kind.options.map((value) => ({
        value: value.id,
        label: value.name,
      }))}
      onChange={onChange}
      size="xs"
      variant="ghost"
      openDirection="up"
      open={open}
      onOpenChange={onOpenChange}
      leftIcon={
        <ProviderIcon providerId={currentAgentId} size={12} className="text-subtle-foreground" />
      }
      className={cn("w-fit max-w-[160px]", className)}
      triggerClassName="w-fit max-w-[160px]"
      hideChevron
      menuClassName={menuClassName}
      menuMinWidth={menuMinWidth}
      menuAnimated={false}
      tooltip={`Select ${option.name}`}
      aria-label={option.name}
    />
  );
}
