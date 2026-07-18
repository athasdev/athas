import { cn } from "@/utils/cn";
import { keybindingToDisplayParts, keysToDisplayParts } from "@/utils/keybinding-display";
import { IS_MAC } from "@/utils/platform";

interface KeybindingProps {
  keys?: string[];
  binding?: string;
  className?: string;
}

export default function Keybinding({ keys, binding, className }: KeybindingProps) {
  const displayParts = binding ? keybindingToDisplayParts(binding) : keysToDisplayParts(keys ?? []);
  const hasKeys = displayParts.some((part) => part.length > 0);

  if (!hasKeys) {
    return null;
  }

  return (
    <span
      className={cn(
        "font-mono ui-text-sm inline-flex items-center whitespace-nowrap text-text-lighter/75",
        className,
      )}
    >
      {displayParts
        .map((part) => part.join(IS_MAC ? "" : "+"))
        .filter(Boolean)
        .join(" ")}
    </span>
  );
}
