import { describe, expect, it } from "vite-plus/test";
import { settingsSearchIndex } from "../config/search-index";
import { getSettingSearchTargetKey, scoreSettingSearchRecord } from "../lib/settings-search";

function searchSettings(query: string) {
  return settingsSearchIndex
    .map((record) => ({ ...record, score: scoreSettingSearchRecord(query, record) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

describe("settings search", () => {
  it("prioritizes exact setting labels", () => {
    const results = searchSettings("auto save");

    expect(results[0]?.id).toBe("editor-auto-save");
  });

  it("finds the Files tab by its visible label", () => {
    const results = searchSettings("files");

    expect(results.some((result) => result.tab === "file-explorer")).toBe(true);
  });

  it("prioritizes the root folder setting for root folder queries", () => {
    const results = searchSettings("root folder");

    expect(results[0]?.id).toBe("file-tree-hide-root-folder");
  });

  it("creates stable DOM target keys for labels and sections", () => {
    expect(getSettingSearchTargetKey("Hide Root Folder")).toBe("hiderootfolder");
    expect(getSettingSearchTargetKey("File Tree")).toBe("filetree");
  });
});
