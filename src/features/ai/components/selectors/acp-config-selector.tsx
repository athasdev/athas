import type { SessionConfigOption } from "@/features/ai/types/acp";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";

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
      variant="secondary"
      open={open}
      onOpenChange={onOpenChange}
      className={cn("w-fit min-w-[132px] max-w-[220px]", className)}
      menuClassName={menuClassName}
      aria-label={option.name}
      title={option.description || option.name}
    />
  );
}
