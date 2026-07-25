import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cva } from "class-variance-authority";
import { cn } from "@/utils/cn";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const switchRootVariants = cva(
  [
    "group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-border bg-secondary-bg outline-none",
    "transition-[transform,background-color,border-color,box-shadow] duration-[var(--app-duration-normal)] ease-[var(--app-ease-smooth)]",
    "data-checked:border-accent data-checked:bg-accent active:scale-[var(--app-press-scale)]",
    "focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-border-strong/35",
    "data-disabled:cursor-not-allowed data-disabled:opacity-50",
  ],
  {
    variants: {
      size: {
        sm: "h-3.5 w-7 p-px",
        md: "h-5 w-9 p-px",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const switchThumbVariants = cva(
  "pointer-events-none block rounded-full bg-text shadow-[var(--shadow-card)] transition-[transform,background-color,box-shadow] duration-[var(--app-duration-normal)] ease-[var(--app-ease-smooth)] group-data-checked/switch:bg-primary-bg",
  {
    variants: {
      size: {
        sm: "size-2.5 group-data-checked/switch:translate-x-3.5",
        md: "size-4 group-data-checked/switch:translate-x-4",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export default function Switch({
  checked,
  onChange,
  disabled = false,
  size = "md",
  className,
}: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-setting-interactive-root="true"
      data-setting-primary-control="true"
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className={cn(switchRootVariants({ size }), className)}
    >
      <SwitchPrimitive.Thumb className={switchThumbVariants({ size })} />
    </SwitchPrimitive.Root>
  );
}
