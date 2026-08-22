import { describe, expect, it } from "vitest";
import {
  adminDataTableToCsv,
  getAdminDataStorageKey,
  jsonToAdminDataTable,
  loadAdminDataSources,
  saveAdminDataSources,
} from "@/features/admin-data/lib/admin-data-model";
import type { AdminDataSource } from "@/features/admin-data/types/admin-data.types";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("admin data model", () => {
  it("turns a root JSON array into a flat table", () => {
    expect(
      jsonToAdminDataTable([
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
    const table = jsonToAdminDataTable(
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
      adminDataTableToCsv({
        columns: ["name", "notes"],
        rows: [["Athas, Preview", 'Says "hello"']],
      }),
    ).toBe('name,notes\n"Athas, Preview","Says ""hello"""');
  });

  it("stores sources separately for each project", () => {
    const storage = createStorage();
    const source: AdminDataSource = {
      id: "release-stats",
      name: "Release stats",
      rowsPath: "assets[]",
      kind: "github",
      endpointPath: "/releases?per_page=100",
    };

    saveAdminDataSources("/projects/athas", [source], storage);

    expect(loadAdminDataSources("/projects/athas", storage)).toEqual([source]);
    expect(loadAdminDataSources("/projects/other", storage)).toEqual([]);
    expect(getAdminDataStorageKey("/projects/athas")).not.toBe(
      getAdminDataStorageKey("/projects/other"),
    );
  });

  it("ignores malformed persisted sources", () => {
    const storage = createStorage();
    storage.setItem(getAdminDataStorageKey("/projects/athas"), "not-json");

    expect(loadAdminDataSources("/projects/athas", storage)).toEqual([]);
  });

  it("migrates URL sources saved before connector types were added", () => {
    const storage = createStorage();
    storage.setItem(
      getAdminDataStorageKey("/projects/athas"),
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

    expect(loadAdminDataSources("/projects/athas", storage)).toEqual([
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
