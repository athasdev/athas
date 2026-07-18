import { describe, expect, it } from "vite-plus/test";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type { SavedConnection } from "../stores/connection.store";
import {
  getSavedFileConnectionPathKeys,
  getWorkspaceDatabaseFiles,
} from "@/features/database/utils/workspace-database-files";

describe("workspace database files", () => {
  it("detects supported file databases from workspace files", () => {
    const files: FileEntry[] = [
      { name: "notes.txt", path: "/workspace/notes.txt", isDir: false },
      {
        name: "data",
        path: "/workspace/data",
        isDir: true,
        children: [
          { name: "app.sqlite", path: "/workspace/data/app.sqlite", isDir: false },
          { name: "warehouse.duckdb", path: "/workspace/data/warehouse.duckdb", isDir: false },
        ],
      },
    ];

    expect(getWorkspaceDatabaseFiles(files, "/workspace")).toEqual([
      {
        id: "workspace-file:/workspace/data/app.sqlite",
        path: "/workspace/data/app.sqlite",
        name: "app.sqlite",
        dbType: "sqlite",
        relativePath: "data/app.sqlite",
      },
      {
        id: "workspace-file:/workspace/data/warehouse.duckdb",
        path: "/workspace/data/warehouse.duckdb",
        name: "warehouse.duckdb",
        dbType: "duckdb",
        relativePath: "data/warehouse.duckdb",
      },
    ]);
  });

  it("does not return database files that are already saved connections", () => {
    const savedConnections: SavedConnection[] = [
      {
        id: "sqlite-app",
        name: "app.sqlite",
        db_type: "sqlite",
        workspace_path: "/workspace",
        file_path: "/workspace/app.sqlite",
        host: "",
        port: 0,
        database: "",
        username: "",
      },
    ];

    expect(
      getWorkspaceDatabaseFiles(
        [{ name: "app.sqlite", path: "/workspace/app.sqlite", isDir: false }],
        "/workspace",
        getSavedFileConnectionPathKeys(savedConnections),
      ),
    ).toEqual([]);
  });
});
