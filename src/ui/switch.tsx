import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/utils/cn";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

const switchClassName =
  "group/switch relative inline-flex h-3.5 w-7 shrink-0 items-center rounded-full border border-border bg-surface p-px outline-none transition-[background-color,border-color,box-shadow] duration-normal ease-smooth data-checked:border-primary data-checked:bg-primary focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-border-strong/35 data-disabled:cursor-not-allowed data-disabled:opacity-50";

const switchThumbClassName =
  "pointer-events-none block size-2.5 rounded-full bg-foreground shadow-(--shadow-card) transition-[transform,background-color,box-shadow] duration-normal ease-smooth group-data-checked/switch:translate-x-3.5 group-data-checked/switch:bg-background";

export default function Switch({ checked, onChange, disabled = false, className }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-setting-interactive-root="true"
      data-setting-primary-control="true"
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className={cn(switchClassName, className)}
    >
      <SwitchPrimitive.Thumb className={switchThumbClassName} />
    </SwitchPrimitive.Root>
  );
}
