import { memo, type KeyboardEventHandler, type RefObject } from "react";
import { MagnifyingGlassIcon as MagnifyingGlass, XIcon as X } from "@/ui/icons";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { CommandInput } from "@/ui/command";
import { SEARCH_TOGGLE_ICONS, SearchReplaceRow, SearchReplaceToggle } from "@/ui/search";
import { TabsList } from "@/ui/tabs";
import { cn } from "@/utils/cn";
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
}: GlobalSearchToolbarProps) {
  const searchOptionButtons = [
    {
      id: "case-sensitive",
      label: "Match case",
      icon: SEARCH_TOGGLE_ICONS.caseSensitive,
      active: searchOptions.caseSensitive,
      onToggle: () => setSearchOption("caseSensitive", !searchOptions.caseSensitive),
    },
    {
      id: "whole-word",
      label: "Match whole word",
      icon: SEARCH_TOGGLE_ICONS.wholeWord,
      active: searchOptions.wholeWord,
      onToggle: () => setSearchOption("wholeWord", !searchOptions.wholeWord),
    },
    {
      id: "regex",
      label: "Use regular expression",
      icon: SEARCH_TOGGLE_ICONS.regex,
      active: searchOptions.useRegex,
      onToggle: () => setSearchOption("useRegex", !searchOptions.useRegex),
    },
  ];

  return (
    <div className="border-border/70 border-b bg-secondary-bg/55 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <SearchReplaceToggle
          isExpanded={detailsVisible}
          onToggle={() => onDetailsVisibleChange(!detailsVisible)}
          expandedLabel="Hide details"
          collapsedLabel="Show details"
        />
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/70 bg-primary-bg/65 px-2">
          <MagnifyingGlass className="size-4 shrink-0 text-text-lighter" weight="duotone" />
          <CommandInput
            ref={inputRef}
            value={query}
            onChange={onQueryChange}
            onKeyDown={onSearchKeyDown}
            placeholder="Search in files..."
            className="font-sans min-w-0"
            aria-label="Search in files"
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="shrink-0 text-text-lighter"
            >
              <X />
            </Button>
          ) : null}
        </div>
        <TabsList variant="segmented" className="shrink-0">
          {searchOptionButtons.map((option) => (
            <Button
              key={option.id}
              type="button"
              onClick={option.onToggle}
              variant="ghost"
              className={cn(
                "h-full w-7 rounded-none border-0 text-text-lighter hover:bg-hover/60 hover:text-text focus-visible:rounded-none",
                option.active && "bg-hover/80 text-text",
              )}
              tooltip={option.label}
              aria-label={option.label}
              aria-pressed={option.active}
              size="icon-xs"
            >
              {option.icon}
            </Button>
          ))}
        </TabsList>
        {searchWarning ? (
          <Badge
            variant="warning"
            className="max-w-64 shrink-0 truncate"
            title={searchWarning}
            role="status"
            aria-live="polite"
          >
            {searchWarning}
          </Badge>
        ) : resultLabel ? (
          <Badge className="max-w-56 shrink-0 truncate" title={resultLabel} role="status">
            {resultLabel}
          </Badge>
        ) : null}
      </div>
      {detailsVisible ? (
        <div className="mt-2 space-y-2">
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
              className="font-sans h-7 rounded-md border border-border/70 bg-primary-bg/65 px-2"
              aria-label="Files to include"
              autoComplete="off"
              spellCheck={false}
            />
            <CommandInput
              value={excludeQuery}
              onChange={onExcludeQueryChange}
              placeholder="Files to exclude"
              className="font-sans h-7 rounded-md border border-border/70 bg-primary-bg/65 px-2"
              aria-label="Files to exclude"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
});
