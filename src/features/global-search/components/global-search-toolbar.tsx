import { memo, type KeyboardEventHandler, type ReactNode, type RefObject } from "react";
import { SearchIcon, XIcon } from "@/ui/icons";
import { MultibufferNavigatorToggle } from "@/features/editor/components/multibuffer/multibuffer-navigator-toggle";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { ChromeLabel } from "@/ui/chrome";
import { CommandInput } from "@/ui/command";
import { SEARCH_TOGGLE_ICONS, SearchReplaceRow, SearchReplaceToggle } from "@/ui/search";
import { Toggle } from "@/ui/toggle";
import type { ContentSearchOptions } from "../types/global-search.types";

interface GlobalSearchToolbarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  replaceInputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  onSearchKeyDown: KeyboardEventHandler<HTMLInputElement>;
  detailsVisible: boolean;
  onDetailsVisibleChange: (visible: boolean) => void;
  searchOptions: ContentSearchOptions;
  setSearchOption: <Key extends keyof ContentSearchOptions>(
    key: Key,
    value: ContentSearchOptions[Key],
  ) => void;
  resultLabel: string | null;
  searchWarning: string | null;
  replaceQuery: string;
  onReplaceQueryChange: (query: string) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  canReplace: boolean;
  canReplaceAll: boolean;
  replaceAllTooltip?: string;
  includeQuery: string;
  onIncludeQueryChange: (query: string) => void;
  excludeQuery: string;
  onExcludeQueryChange: (query: string) => void;
  fileNavigatorAvailable: boolean;
  fileNavigatorVisible: boolean;
  onFileNavigatorVisibleChange: (visible: boolean) => void;
}

export const GlobalSearchToolbar = memo(function GlobalSearchToolbar({
  inputRef,
  replaceInputRef,
  query,
  onQueryChange,
  onSearchKeyDown,
  detailsVisible,
  onDetailsVisibleChange,
  searchOptions,
  setSearchOption,
  resultLabel,
  searchWarning,
  replaceQuery,
  onReplaceQueryChange,
  onReplace,
  onReplaceAll,
  canReplace,
  canReplaceAll,
  replaceAllTooltip,
  includeQuery,
  onIncludeQueryChange,
  excludeQuery,
  onExcludeQueryChange,
  fileNavigatorAvailable,
  fileNavigatorVisible,
  onFileNavigatorVisibleChange,
}: GlobalSearchToolbarProps) {
  const searchOptionToggles: Array<{
    key: "caseSensitive" | "wholeWord" | "useRegex";
    label: string;
    icon: ReactNode;
  }> = [
    { key: "caseSensitive", label: "Match case", icon: SEARCH_TOGGLE_ICONS.caseSensitive },
    { key: "wholeWord", label: "Match whole word", icon: SEARCH_TOGGLE_ICONS.wholeWord },
    { key: "useRegex", label: "Use regular expression", icon: SEARCH_TOGGLE_ICONS.regex },
  ];

  return (
    <>
      <PaneContentHeader
        separated={!detailsVisible}
        leading={
          <SearchReplaceToggle
            isExpanded={detailsVisible}
            onToggle={() => onDetailsVisibleChange(!detailsVisible)}
            expandedLabel="Hide details"
            collapsedLabel="Show details"
          />
        }
        context={
          <div className="flex h-6 min-w-0 flex-1 items-center gap-2">
            <SearchIcon className="size-4 shrink-0 text-subtle-foreground" />
            <CommandInput
              ref={inputRef}
              value={query}
              onChange={onQueryChange}
              onKeyDown={onSearchKeyDown}
              placeholder="Search in files..."

              aria-label="Search in files"
              autoComplete="off"
              spellCheck={false}
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                onClick={() => {
                  onQueryChange("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <XIcon />
              </Button>
            ) : null}
          </div>
        }
        actions={
          <>
            <div role="group" aria-label="Search options" className="flex shrink-0 items-center">
              {searchOptionToggles.map((option) => (
                <Toggle
                  key={option.key}
                  size="sm"
                  pressed={searchOptions[option.key]}
                  onPressedChange={(pressed) => setSearchOption(option.key, pressed)}
                  tooltip={option.label}
                  aria-label={option.label}
                >
                  {option.icon}
                </Toggle>
              ))}
            </div>
            {searchWarning ? (
              <Badge tone="warning" truncate title={searchWarning} role="status" aria-live="polite">
                {searchWarning}
              </Badge>
            ) : resultLabel ? (
              <ChromeLabel tone="muted" title={resultLabel} role="status" className="px-1">
                {resultLabel}
              </ChromeLabel>
            ) : null}
            <MultibufferNavigatorToggle
              open={fileNavigatorVisible}
              onOpenChange={onFileNavigatorVisibleChange}
              disabled={!fileNavigatorAvailable}
            />
          </>
        }
      />
      {detailsVisible ? (
        <div className="space-y-2 border-border border-b bg-background px-2 pb-2">
          <SearchReplaceRow
            value={replaceQuery}
            onChange={onReplaceQueryChange}
            inputRef={replaceInputRef}
            onReplace={onReplace}
            onReplaceAll={onReplaceAll}
            canReplace={canReplace}
            canReplaceAll={canReplaceAll}
            replaceAllTooltip={replaceAllTooltip}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canReplace) {
                event.preventDefault();
                onReplace();
              }
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <CommandInput
              value={includeQuery}
              onChange={onIncludeQueryChange}
              placeholder="Files to include"
              variant="field"
              aria-label="Files to include"
              autoComplete="off"
              spellCheck={false}
            />
            <CommandInput
              value={excludeQuery}
              onChange={onExcludeQueryChange}
              placeholder="Files to exclude"
              variant="field"
              aria-label="Files to exclude"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
      ) : null}
    </>
  );
});
