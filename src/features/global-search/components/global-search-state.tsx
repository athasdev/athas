import { MagnifyingGlassIcon as MagnifyingGlass } from "@/ui/icons";
import { Button } from "@/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";
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
    <Empty className="h-full min-h-80 px-6">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-11 border border-border bg-surface">
          <MagnifyingGlass className="size-6" weight="duotone" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription className="ui-text-base">{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
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
      <Empty className="min-h-60 px-6">
        <EmptyDescription className="ui-text-base">
          Global search is not available for this workspace type.
        </EmptyDescription>
      </Empty>
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
      <Empty className="min-h-60" role="status" aria-live="polite">
        <EmptyDescription className="ui-text-base">{busyLabel}</EmptyDescription>
      </Empty>
    );
  }

  if (error) {
    return (
      <Empty className="min-h-60 px-6" role="alert">
        <EmptyHeader>
          <EmptyTitle>Search failed</EmptyTitle>
          <EmptyDescription className="ui-text-base text-destructive">{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" variant="default" onClick={onRetry}>
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (debouncedQuery.trim()) {
    return (
      <Empty className="min-h-60" role="status">
        <EmptyHeader>
          <EmptyTitle>No results found</EmptyTitle>
          <EmptyDescription className="ui-text-base">
            No results found for "{debouncedQuery}"
            {hasFileFilters ? " with the current file filters" : ""}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return null;
}
