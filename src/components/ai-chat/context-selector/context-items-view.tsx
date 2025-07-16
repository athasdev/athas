import { ArrowLeft, GitBranch, GitCommit, Globe, Package } from "lucide-react";
import { cn } from "../../../utils/cn";
import FileIcon from "../../file-icon";
import type { ContextCategory, ContextItem } from "./types";

interface ContextItemsViewProps {
  category: ContextCategory;
  items: ContextItem[];
  selectedIndex: number;
  searchQuery: string;
  onItemSelect: (item: ContextItem) => void;
  onBack: () => void;
  onSearchChange: (query: string) => void;
}

export function ContextItemsView({
  category,
  items,
  selectedIndex,
  searchQuery,
  onItemSelect,
  onBack,
  onSearchChange,
}: ContextItemsViewProps) {
  const Icon = category.icon;

  return (
    <div className="p-1">
      {/* Header */}
      <div className="mb-1 flex items-center gap-2 border-border border-b px-2 py-1">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-text-lighter transition-colors hover:text-text"
        >
          <ArrowLeft size={12} />
          <span className="text-xs">Back</span>
        </button>

        <div className="flex flex-1 items-center gap-2">
          <Icon size={14} className="text-text-lighter" />
          <span className="font-medium text-text text-xs">{category.name}</span>
        </div>

        <div className="text-text-lighter text-xs">{items.length} items</div>
      </div>

      {/* Search Input */}
      <div className="mb-1 px-2 py-1">
        <input
          type="text"
          placeholder={`Search ${category.name.toLowerCase()}...`}
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          className="w-full rounded border border-border bg-secondary-bg px-2 py-1 text-text text-xs placeholder-text-lighter focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Items */}
      <div className="max-h-64 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-4 text-center text-text-lighter text-xs">
            No {category.name.toLowerCase()} found
          </div>
        ) : (
          items.map((item, index) => {
            const isSelected = index === selectedIndex;

            return (
              <div
                key={item.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs transition-all duration-150",
                  isSelected
                    ? "border-blue-500 border-l-2 bg-blue-500/20 text-blue-300"
                    : "bg-transparent hover:bg-hover",
                )}
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  onItemSelect(item);
                }}
              >
                {item.type === "file" && (
                  <FileIcon
                    fileName={item.name}
                    isDir={false}
                    size={11}
                    className={cn(
                      "flex-shrink-0",
                      isSelected ? "text-blue-400" : "text-text-lighter",
                    )}
                  />
                )}

                {item.type === "url" && (
                  <Globe
                    size={11}
                    className={cn(
                      "flex-shrink-0",
                      isSelected ? "text-blue-400" : "text-text-lighter",
                    )}
                  />
                )}

                {item.type?.startsWith("git-") && (
                  <>
                    {(item.type === "git-branch" || item.type === "git-branch-other") && (
                      <GitBranch
                        size={11}
                        className={cn(
                          "flex-shrink-0",
                          isSelected ? "text-blue-400" : "text-text-lighter",
                        )}
                      />
                    )}
                    {item.type === "git-commit" && (
                      <GitCommit
                        size={11}
                        className={cn(
                          "flex-shrink-0",
                          isSelected ? "text-blue-400" : "text-text-lighter",
                        )}
                      />
                    )}
                    {(item.type === "git-staged" ||
                      item.type === "git-modified" ||
                      item.type === "git-untracked" ||
                      item.type === "git-stash") && (
                      <Package
                        size={11}
                        className={cn(
                          "flex-shrink-0",
                          isSelected ? "text-blue-400" : "text-text-lighter",
                        )}
                      />
                    )}
                  </>
                )}

                {item.icon && item.type !== "url" && !item.type?.startsWith("git-") && (
                  <item.icon
                    size={11}
                    className={cn(
                      "flex-shrink-0",
                      isSelected ? "text-blue-400" : "text-text-lighter",
                    )}
                  />
                )}

                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="truncate">
                    <span
                      className={cn(
                        "font-mono",
                        isSelected ? "font-medium text-blue-200" : "text-text",
                      )}
                    >
                      {item.name}
                    </span>
                    {item.description && (
                      <span
                        className={cn(
                          "ml-2 text-xs opacity-60",
                          isSelected ? "text-blue-300/70" : "text-text-lighter",
                        )}
                      >
                        {item.description}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
