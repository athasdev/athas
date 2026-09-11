import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { matchesSearchQuery } from "@/utils/search-match";

/**
 * Query state for a searchable menu surface (`DropdownMenuSearch` and friends).
 *
 * Every searchable menu used to re-implement this inline, which is why the
 * behaviour drifted: some surfaces cleared the query on close and some kept it,
 * and only one deferred the filter. Owning it here keeps all of them identical.
 */
export function useMenuSearch() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const reset = useCallback(() => setQuery(""), []);

  /** Clears the query whenever the surface closes. Spread onto the root. */
  const menuProps = useMemo(
    () => ({
      onOpenChange: (open: boolean) => {
        if (!open) setQuery("");
      },
    }),
    [],
  );

  const filter = useCallback(
    <T>(items: readonly T[], fields: (item: T) => readonly (string | null | undefined)[]) =>
      items.filter((item) => matchesSearchQuery(deferredQuery, fields(item))),
    [deferredQuery],
  );

  return {
    /** Bind to the search input's `value`. */
    query,
    /** Bind to the search input's `onChange`. */
    setQuery,
    /** Deferred query used for filtering, so typing stays responsive. */
    deferredQuery,
    /** True once the user has typed something meaningful. */
    isSearching: query.trim().length > 0,
    reset,
    menuProps,
    filter,
  };
}

export type MenuSearch = ReturnType<typeof useMenuSearch>;
