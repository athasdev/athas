import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { GlobalSearchState } from "../components/global-search-state";

function renderSearchState(props: Partial<Parameters<typeof GlobalSearchState>[0]> = {}) {
  return renderToStaticMarkup(
    <GlobalSearchState
      availability="ready"
      query=""
      debouncedQuery=""
      busyLabel={null}
      showBusy={false}
      error={null}
      hasFileFilters={false}
      onRetry={vi.fn()}
      {...props}
    />,
  );
}

describe("GlobalSearchState", () => {
  it("uses the shared compact empty state before a query is entered", () => {
    const markup = renderSearchState();

    expect(markup).toContain('data-slot="empty"');
    expect(markup).toContain("Enter a query to search files and lines.");
    expect(markup).not.toContain("Search across your project");
  });

  it("keeps no-result feedback compact and includes active filters", () => {
    const markup = renderSearchState({
      query: "missing",
      debouncedQuery: "missing",
      hasFileFilters: true,
    });

    expect(markup).toContain('role="status"');
    expect(markup).toContain("No results for &quot;missing&quot; with the current file filters.");
  });

  it("uses the shared error action", () => {
    const markup = renderSearchState({
      query: "broken",
      debouncedQuery: "broken",
      error: "Search service failed",
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Search failed");
    expect(markup).toContain("Try again");
  });
});
