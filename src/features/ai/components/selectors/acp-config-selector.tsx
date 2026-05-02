import type { SessionConfigOption } from "@/features/ai/types/acp";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAIChatStore } from "@/features/ai/store/store";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import { chatComposerControlClassName } from "../input/chat-composer-control-styles";

interface AcpConfigSelectorProps {
  option: SessionConfigOption;
  onChange: (value: string) => void;
  className?: string;
  menuClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AcpConfigSelector({
  option,
  onChange,
  className,
  menuClassName,
  open,
  onOpenChange,
}: AcpConfigSelectorProps) {
  const getCurrentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
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
      open={open}
      onOpenChange={onOpenChange}
      leftIcon={
        <ProviderIcon providerId={currentAgentId} size={12} className="text-text-lighter" />
      }
      className={cn("w-fit max-w-[160px]", className)}
      triggerClassName={chatComposerControlClassName("w-fit max-w-[160px]")}
      hideChevron
      menuClassName={menuClassName}
      tooltip="Select model"
      aria-label={option.name}
      title={option.description || option.name}
    />
  );
}
