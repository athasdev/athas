import { afterEach, describe, expect, it } from "vite-plus/test";
import { useGlobalSearchSessionStore } from "../stores/global-search-session.store";

describe("global search session store", () => {
  afterEach(() => {
    useGlobalSearchSessionStore.getState().actions.reset();
  });

  it("retains search inputs and options when the search buffer remounts", () => {
    const { actions } = useGlobalSearchSessionStore.getState();

    actions.setQuery("virtualizer");
    actions.setReplaceQuery("viewport");
    actions.setIncludeQuery("src/**");
    actions.setExcludeQuery("**/*.test.ts");
    actions.setSearchOption("caseSensitive", true);

    expect(useGlobalSearchSessionStore.getState()).toMatchObject({
      query: "virtualizer",
      replaceQuery: "viewport",
      includeQuery: "src/**",
      excludeQuery: "**/*.test.ts",
      searchOptions: {
        caseSensitive: true,
        wholeWord: false,
        useRegex: false,
      },
    });
  });

  it("can clear the retained session explicitly", () => {
    const { actions } = useGlobalSearchSessionStore.getState();
    actions.setQuery("stale query");
    actions.setSearchOption("useRegex", true);

    actions.reset();

    expect(useGlobalSearchSessionStore.getState()).toMatchObject({
      query: "",
      replaceQuery: "",
      includeQuery: "",
      excludeQuery: "",
      searchOptions: {
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,
      },
    });
  });
});
