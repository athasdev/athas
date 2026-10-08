import { afterEach, describe, expect, it } from "vite-plus/test";
import { useSettingsSearchStore } from "../stores/settings-search.store";

describe("settings search store", () => {
  afterEach(() => {
    useSettingsSearchStore.getState().actions.clear();
  });

  it("ranks results for the query and resets the selection when the query changes", () => {
    const { actions } = useSettingsSearchStore.getState();

    actions.setQuery("auto save");
    expect(useSettingsSearchStore.getState().results[0]?.id).toBe("editor-auto-save");

    actions.selectResult("editor-auto-save");
    expect(useSettingsSearchStore.getState().selectedResultId).toBe("editor-auto-save");

    actions.setQuery("font ligatures");
    expect(useSettingsSearchStore.getState()).toMatchObject({
      query: "font ligatures",
      selectedResultId: null,
    });
    expect(useSettingsSearchStore.getState().results[0]?.id).toBe("editor-font-ligatures");
  });

  it("returns no results for a blank query", () => {
    useSettingsSearchStore.getState().actions.setQuery("   ");

    expect(useSettingsSearchStore.getState().results).toEqual([]);
  });

  it("clears the query, results, and selection", () => {
    const { actions } = useSettingsSearchStore.getState();
    actions.setQuery("auto save");
    actions.selectResult("editor-auto-save");

    actions.clear();

    expect(useSettingsSearchStore.getState()).toMatchObject({
      query: "",
      results: [],
      selectedResultId: null,
    });
  });
});
