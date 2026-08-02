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

  it("finds the new editor and terminal interaction settings", () => {
    expect(searchSettings("font ligatures")[0]?.id).toBe("editor-font-ligatures");
    expect(searchSettings("option as meta")[0]?.id).toBe("terminal-option-as-meta");
    expect(searchSettings("inactive cursor style")[0]?.id).toBe("terminal-cursor-inactive-style");
  });

  it("finds interface and layout settings", () => {
    expect(searchSettings("reduce motion")[0]?.id).toBe("appearance-reduce-motion");
    expect(searchSettings("tab close buttons")[0]?.id).toBe("appearance-tab-close-buttons");
    expect(searchSettings("window chrome density")[0]?.id).toBe("appearance-window-chrome-density");
    expect(searchSettings("sidebar width")[0]?.id).toBe("appearance-sidebar-width");
  });

  it("finds file tree display and behavior settings", () => {
    expect(searchSettings("sort order")[0]?.id).toBe("file-tree-sort-order");
    expect(searchSettings("auto reveal active file")[0]?.id).toBe(
      "file-tree-auto-reveal-active-file",
    );
    expect(searchSettings("confirm before delete")[0]?.id).toBe("file-tree-confirm-before-delete");
  });

  it("creates stable DOM target keys for labels and sections", () => {
    expect(getSettingSearchTargetKey("Hide Root Folder")).toBe("hiderootfolder");
    expect(getSettingSearchTargetKey("File Tree")).toBe("filetree");
  });
});
