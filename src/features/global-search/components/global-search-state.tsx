import { MagnifyingGlassIcon as MagnifyingGlass } from "@/ui/icons";
import { EmptyState } from "@/ui/empty";
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
      <EmptyState
        layout="sidebar"
        icon={<MagnifyingGlass weight="duotone" />}
        message="Open a project to search files."
      />
    );
  }

  if (availability === "unsupported") {
    return <EmptyState layout="sidebar" message="Search isn't available for this workspace." />;
  }

  if (!query.trim()) {
    return (
      <EmptyState
        layout="sidebar"
        icon={<MagnifyingGlass weight="duotone" />}
        message="Enter a query to search files and lines."
      />
    );
  }

  if (showBusy && busyLabel) {
    return <EmptyState layout="sidebar" message={busyLabel} role="status" aria-live="polite" />;
  }

  if (error) {
    return (
      <EmptyState
        layout="sidebar"
        tone="error"
        title="Search failed"
        message={error}
        action={{ label: "Try again", onClick: onRetry }}
        role="alert"
      />
    );
  }

  if (debouncedQuery.trim()) {
    return (
      <EmptyState
        layout="sidebar"
        message={`No results for "${debouncedQuery}"${
          hasFileFilters ? " with the current file filters" : ""
        }.`}
        role="status"
      />
    );
  }

  return null;
}
