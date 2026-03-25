import { cva } from "class-variance-authority";
import { cn } from "@/utils/cn";
import { keybindingToDisplay } from "@/utils/keybinding-display";

interface KeybindingProps {
  keys?: string[];
  binding?: string;
  className?: string;
  separator?: string;
}

const keybindingKeyVariants = cva(
  "ui-font ui-text-sm inline-flex min-h-4 min-w-4 items-center justify-center rounded-md border border-border bg-secondary-bg px-1 leading-none text-text-lighter shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)]",
);

export default function Keybinding({ keys, binding, className, separator = "+" }: KeybindingProps) {
  const displayKeys = binding ? keybindingToDisplay(binding) : (keys ?? []);

  if (displayKeys.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {displayKeys.map((key, index) => (
        <span key={index} className="flex items-center gap-0.5">
          <kbd className={keybindingKeyVariants()}>{key}</kbd>
          {index < displayKeys.length - 1 && (
            <span className="ui-text-sm text-text-lighter">{separator}</span>
          )}
        </span>
      ))}
    </div>
  );
}
