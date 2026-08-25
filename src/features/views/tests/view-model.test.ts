import { describe, expect, it } from "vitest";
import {
  viewTableToCsv,
  getViewsStorageKey,
  jsonToViewTable,
  loadViews,
  saveViews,
} from "@/features/views/lib/view-model";
import type { CustomViewDefinition } from "@/features/views/types/view.types";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("custom view model", () => {
  it("turns a root JSON array into a flat table", () => {
    expect(
      jsonToViewTable([
        { tag_name: "v1.0.0", author: { login: "athas" }, draft: false },
        { tag_name: "v1.1.0", author: { login: "codex" }, draft: true },
      ]),
    ).toEqual({
      columns: ["tag_name", "author.login", "draft"],
      rows: [
        ["v1.0.0", "athas", false],
        ["v1.1.0", "codex", true],
      ],
    });
  });

  it("expands nested arrays with a rows path", () => {
    const table = jsonToViewTable(
      [
        {
          tag_name: "v1.0.0",
          assets: [
            { name: "mac.zip", download_count: 12 },
            { name: "linux.tar.gz", download_count: 8 },
          ],
        },
      ],
      "assets[]",
    );

    expect(table).toEqual({
      columns: ["name", "download_count"],
      rows: [
        ["mac.zip", 12],
        ["linux.tar.gz", 8],
      ],
    });
  });

  it("escapes table values as CSV", () => {
    expect(
      viewTableToCsv({
        columns: ["name", "notes"],
        rows: [["Athas, Preview", 'Says "hello"']],
      }),
    ).toBe('name,notes\n"Athas, Preview","Says ""hello"""');
  });

  it("stores views separately for each project", () => {
    const storage = createStorage();
    const view: CustomViewDefinition = {
      id: "release-stats",
      name: "Release stats",
      rowsPath: "assets[]",
      kind: "github",
      endpointPath: "/releases?per_page=100",
    };

    saveViews("/projects/athas", [view], storage);

    expect(loadViews("/projects/athas", storage)).toEqual([view]);
    expect(loadViews("/projects/other", storage)).toEqual([]);
    expect(getViewsStorageKey("/projects/athas")).not.toBe(getViewsStorageKey("/projects/other"));
  });

  it("ignores malformed persisted views", () => {
    const storage = createStorage();
    storage.setItem(getViewsStorageKey("/projects/athas"), "not-json");

    expect(loadViews("/projects/athas", storage)).toEqual([]);
  });

  it("loads views stored before the feature rename", () => {
    const storage = createStorage();
    const view: CustomViewDefinition = {
      id: "release-stats",
      name: "Release stats",
      rowsPath: "assets[]",
      kind: "github",
      endpointPath: "/releases?per_page=100",
    };
    storage.setItem("athas-admin-data-sources:%2Fprojects%2Fathas", JSON.stringify([view]));

    expect(loadViews("/projects/athas", storage)).toEqual([view]);
  });

  it("migrates URL sources saved before connector types were added", () => {
    const storage = createStorage();
    storage.setItem(
      getViewsStorageKey("/projects/athas"),
      JSON.stringify([
        {
          id: "legacy",
          name: "Legacy source",
          url: "https://api.example.com/data",
          rowsPath: "items",
          authentication: "none",
        },
      ]),
    );

    expect(loadViews("/projects/athas", storage)).toEqual([
      {
        id: "legacy",
        name: "Legacy source",
        kind: "json",
        url: "https://api.example.com/data",
        rowsPath: "items",
        authentication: "none",
      },
    ]);
  });
});
