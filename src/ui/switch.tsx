import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/utils/cn";

interface SwitchProps extends Omit<SwitchPrimitive.Root.Props, "onCheckedChange"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const switchClassName =
  "group/switch relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-selected p-0.5 outline-none ring-1 ring-border ring-inset transition-[background-color,box-shadow] duration-normal ease-smooth hover:bg-border data-checked:bg-primary data-checked:ring-primary data-checked:hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus data-disabled:cursor-not-allowed data-disabled:opacity-50";

const switchThumbClassName =
  "pointer-events-none block size-3 rounded-full bg-foreground shadow-(--shadow-card) transition-[transform,background-color] duration-normal ease-smooth group-data-checked/switch:translate-x-3 group-data-checked/switch:bg-primary-foreground";

export default function Switch({ checked, onChange, className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-setting-interactive-root="true"
      data-setting-primary-control="true"
      checked={checked}
      onCheckedChange={onChange}
      className={cn(switchClassName, className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className={switchThumbClassName} />
    </SwitchPrimitive.Root>
  );
}
