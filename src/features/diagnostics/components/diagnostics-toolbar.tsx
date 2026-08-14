import type { MouseEvent, RefObject } from "react";
import {
  FilesIcon as Files,
  FunnelIcon as Filter,
  MagnifyingGlassIcon as Search,
  XIcon as X,
} from "@/ui/icons";
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
    <div className="@container/diagnostics-toolbar border-border/70 border-b px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <div className="flex h-7 min-w-48 basis-64 flex-1 items-center gap-2">
          <Search className="size-4 shrink-0 text-subtle-foreground" weight="duotone" />
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
              size="icon-xs"
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              aria-label="Clear problem search"
              className="shrink-0 text-subtle-foreground"
            >
              <X />
            </Button>
          ) : null}
        </div>

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            active={activeFilterCount > 0}
            onClick={onOpenFilters}
            tooltip={activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filter problems"}
            tooltipSide="bottom"
            aria-label="Filter problems"
          >
            <Filter />
          </Button>
          <Badge className="max-w-56 shrink truncate" title={resultSummary} role="status">
            {resultLabel}
          </Badge>
          {fileNavigatorAvailable ? (
            <Toggle
              pressed={fileNavigatorVisible}
              onPressedChange={onFileNavigatorVisibleChange}
              size="xs"
              tooltip={fileNavigatorVisible ? "Hide problem files" : "Show problem files"}
              tooltipSide="bottom"
            >
              <Files />
            </Toggle>
          ) : null}
        </div>
      </div>
    </div>
  );
}
