import { MagnifyingGlassIcon as MagnifyingGlass } from "@/ui/icons";
import { Button } from "@/ui/button";
import type { ContentSearchAvailability } from "../hooks/use-content-search";

interface GlobalSearchStateProps {
  availability: ContentSearchAvailability;
  query: string;
  debouncedQuery: string;
  busyLabel: string | null;
  showBusy: boolean;
  error: string | null;
  hasFileFilters: boolean;
  onRetry: () => void;
}

function SearchIntroduction({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-3 flex size-11 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-lighter">
          <MagnifyingGlass className="size-6" weight="duotone" />
        </div>
        <div className="ui-text-base font-medium text-text">{title}</div>
        <div className="ui-text-base mt-1 text-text-lighter">{description}</div>
      </div>
    </div>
  );
}

export function GlobalSearchState({
  availability,
  query,
  debouncedQuery,
  busyLabel,
  showBusy,
  error,
  hasFileFilters,
  onRetry,
}: GlobalSearchStateProps) {
  if (availability === "no-workspace") {
    return (
      <SearchIntroduction
        title="Open a project to search"
        description="Global search needs an open project folder."
      />
    );
  }

  if (availability === "unsupported") {
    return (
      <div className="ui-text-base flex min-h-[240px] items-center justify-center px-6 text-center text-text-lighter">
        Global search is not available for this workspace type.
      </div>
    );
  }

  if (!query.trim()) {
    return (
      <SearchIntroduction
        title="Search across your project"
        description="Type a query to see matching files and lines in a project-wide result buffer."
      />
    );
  }

  if (showBusy && busyLabel) {
    return (
      <div
        className="ui-text-base flex min-h-[240px] items-center justify-center text-center text-text-lighter"
        role="status"
        aria-live="polite"
      >
        {busyLabel}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="ui-text-base flex min-h-[240px] flex-col items-center justify-center gap-3 px-6 text-center text-error"
        role="alert"
      >
        <span>{error}</span>
        <Button type="button" variant="default" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (debouncedQuery.trim()) {
    return (
      <div
        className="ui-text-base flex min-h-[240px] items-center justify-center text-center text-text-lighter"
        role="status"
      >
        No results found for "{debouncedQuery}"
        {hasFileFilters ? " with the current file filters" : ""}
      </div>
    );
  }

  return null;
}
