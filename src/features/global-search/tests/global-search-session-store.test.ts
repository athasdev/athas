import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { beforeEach, afterEach, describe, expect, it } from "vite-plus/test";
import { useGlobalSearchSessionStore } from "../stores/global-search-session.store";

describe("global search session store", () => {
  beforeEach(() => workspaceRuntimeRegistry.resetForTests());
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

  it("keeps each workspace query, filters, replacement and options separate", () => {
    workspaceRuntimeRegistry.activateWorkspace({ id: "first", name: "First" });
    const first = useGlobalSearchSessionStore.getState().actions;
    first.setQuery("first");
    first.setReplaceQuery("replacement");
    first.setIncludeQuery("src/**");
    first.setSearchOption("useRegex", true);
    workspaceRuntimeRegistry.activateWorkspace({ id: "second", name: "Second" });
    expect(useGlobalSearchSessionStore.getState()).toMatchObject({
      query: "",
      replaceQuery: "",
      includeQuery: "",
      searchOptions: { useRegex: false },
    });
    useGlobalSearchSessionStore.getState().actions.setQuery("second");
    workspaceRuntimeRegistry.activateWorkspace({ id: "first", name: "First" });
    expect(useGlobalSearchSessionStore.getState()).toMatchObject({
      query: "first",
      replaceQuery: "replacement",
      includeQuery: "src/**",
      searchOptions: { useRegex: true },
    });
  });
  it("does not retain the search session from a retired workspace with the same ID", () => {
    workspaceRuntimeRegistry.activateWorkspace({ id: "first", name: "First" });
    useGlobalSearchSessionStore.getState().actions.setQuery("old");
    workspaceRuntimeRegistry.removeWorkspace("first");
    workspaceRuntimeRegistry.activateWorkspace({ id: "first", name: "Reopened" });
    expect(useGlobalSearchSessionStore.getState().query).toBe("");
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
