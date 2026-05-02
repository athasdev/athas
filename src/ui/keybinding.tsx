import { cva } from "class-variance-authority";
import { cn } from "@/utils/cn";
import { keybindingToDisplay } from "@/utils/keybinding-display";
import { IS_MAC } from "@/utils/platform";

interface KeybindingProps {
  keys?: string[];
  binding?: string;
  className?: string;
}

const keybindingKeyVariants = cva(
  "ui-font ui-text-sm inline-flex min-h-4 items-center justify-center rounded-md border border-border bg-secondary-bg px-1.5 leading-none text-text-lighter shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)]",
);

export default function Keybinding({ keys, binding, className }: KeybindingProps) {
  const displayKeys = binding ? keybindingToDisplay(binding) : (keys ?? []);

  if (displayKeys.length === 0) {
    return null;
  }

  return (
    <kbd className={cn(keybindingKeyVariants(), className)}>
      {displayKeys.join(IS_MAC ? "" : "+")}
    </kbd>
  );
}
