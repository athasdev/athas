import { cn } from "../../../utils/cn";
import type { ContextCategory } from "./types";

interface ContextCategoryViewProps {
  categories: ContextCategory[];
  selectedIndex: number;
  onCategorySelect: (category: ContextCategory) => void;
}

export function ContextCategoryView({
  categories,
  selectedIndex,
  onCategorySelect,
}: ContextCategoryViewProps) {
  return (
    <div className="p-1">
      <div className="px-2 py-1 font-medium text-text-lighter text-xs">Select Context Type</div>
      {categories.map((category, index) => {
        const Icon = category.icon;
        const isSelected = index === selectedIndex;

        return (
          <div
            key={category.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs transition-all duration-150",
              isSelected
                ? "border-blue-500 border-l-2 bg-blue-500/20 text-blue-300"
                : "bg-transparent hover:bg-hover",
            )}
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onCategorySelect(category);
            }}
          >
            <Icon
              size={12}
              className={cn("flex-shrink-0", isSelected ? "text-blue-400" : "text-text-lighter")}
            />

            <div className="min-w-0 flex-1">
              <span
                className={cn("truncate font-medium", isSelected ? "text-blue-200" : "text-text")}
              >
                {category.name}
              </span>
            </div>

            {category.shortcut && (
              <div
                className={cn(
                  "rounded border px-1 py-0.5 font-mono text-xs",
                  isSelected
                    ? "border-blue-500/50 bg-blue-500/30 text-blue-300"
                    : "border-border bg-secondary-bg text-text-lighter",
                )}
              >
                {category.shortcut}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
