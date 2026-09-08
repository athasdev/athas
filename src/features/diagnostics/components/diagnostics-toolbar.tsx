import type { MouseEvent, RefObject } from "react";
import { FilesIcon, FilterIcon, SearchIcon, XIcon } from "@/ui/icons";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { CommandInput } from "@/ui/command";
import { Toggle } from "@/ui/toggle";

interface DiagnosticsToolbarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  onOpenFilters: (event: MouseEvent<HTMLElement>) => void;
  activeFilterCount: number;
  resultLabel: string;
  resultSummary: string;
  fileNavigatorAvailable: boolean;
  fileNavigatorVisible: boolean;
  onFileNavigatorVisibleChange: (visible: boolean) => void;
}

export function DiagnosticsToolbar({
  inputRef,
  query,
  onQueryChange,
  onOpenFilters,
  activeFilterCount,
  resultLabel,
  resultSummary,
  fileNavigatorAvailable,
  fileNavigatorVisible,
  onFileNavigatorVisibleChange,
}: DiagnosticsToolbarProps) {
  return (
    <PaneContentHeader
      context={
        <div className="flex h-6 min-w-0 flex-1 items-center gap-2">
          <SearchIcon className="size-4 shrink-0 text-subtle-foreground" />
          <CommandInput
            ref={inputRef}
            value={query}
            onChange={onQueryChange}
            placeholder="Search problems..."
            className="font-sans min-w-0"
            aria-label="Search problems"
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
              aria-label="Clear problem search"
              className="shrink-0 text-subtle-foreground"
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      }
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            active={activeFilterCount > 0}
            onClick={onOpenFilters}
            tooltip={activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filter problems"}
            aria-label="Filter problems"
          >
            <FilterIcon />
          </Button>
          <Badge truncate title={resultSummary} role="status">
            {resultLabel}
          </Badge>
          {fileNavigatorAvailable ? (
            <Toggle
              pressed={fileNavigatorVisible}
              onPressedChange={onFileNavigatorVisibleChange}
              tooltip={fileNavigatorVisible ? "Hide problem files" : "Show problem files"}
            >
              <FilesIcon />
            </Toggle>
          ) : null}
        </>
      }
    />
  );
}
