import { cva } from "class-variance-authority";
import { cn } from "@/utils/cn";
import { keybindingToDisplayParts, keysToDisplayParts } from "@/utils/keybinding-display";

interface KeybindingProps {
  keys?: string[];
  binding?: string;
  className?: string;
}

const keybindingKeyVariants = cva(
  "ui-font ui-text-sm inline-flex min-h-4 items-center justify-center rounded-md border border-border bg-secondary-bg px-1.5 leading-none text-text-lighter shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)]",
);

export default function Keybinding({ keys, binding, className }: KeybindingProps) {
  const displayParts = binding ? keybindingToDisplayParts(binding) : keysToDisplayParts(keys ?? []);
  const hasKeys = displayParts.some((part) => part.length > 0);

  if (!hasKeys) {
    return null;
  }

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {displayParts.map((part, partIndex) => (
        <span key={`${part.join("-")}-${partIndex}`} className="inline-flex items-center gap-0.5">
          {part.map((key, keyIndex) => (
            <kbd key={`${key}-${keyIndex}`} className={keybindingKeyVariants()}>
              {key}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
