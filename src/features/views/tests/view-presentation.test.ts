import { describe, expect, it } from "vitest";
import {
  groupViewRows,
  humanizeViewColumn,
  resolveViewPresentation,
} from "@/features/views/lib/view-presentation";
import type { CustomViewDefinition, ViewTable } from "@/features/views/types/view.types";

const table: ViewTable = {
  columns: ["title", "status", "author.login", "created_at"],
  rows: [
    ["Fix sidebar", "open", "mehmet", "2026-08-27T10:00:00Z"],
    ["Ship views", "closed", "codex", "2026-08-27T12:00:00Z"],
    ["Improve table", "open", "mehmet", "2026-08-27T13:00:00Z"],
  ],
};

function view(presentation?: CustomViewDefinition["presentation"]): CustomViewDefinition {
  return {
    id: "issues",
    name: "Issues",
    kind: "github",
    endpointPath: "/issues",
    rowsPath: "",
    presentation,
  };
}

describe("view presentation", () => {
  it("infers useful title and status grouping for boards", () => {
    expect(resolveViewPresentation(view({ layout: "board" }), table)).toEqual({
      layout: "board",
      titleColumn: "title",
      groupBy: "status",
    });
  });

  it("allows automatic board grouping to be explicitly disabled", () => {
    expect(resolveViewPresentation(view({ layout: "board", groupBy: null }), table)).toEqual({
      layout: "board",
      titleColumn: "title",
    });
  });

  it("groups rows by any selected column", () => {
    expect(groupViewRows(table, "status")).toEqual([
      {
        key: "open",
        label: "open",
        rows: [
          { index: 0, cells: table.rows[0] },
          { index: 2, cells: table.rows[2] },
        ],
      },
      {
        key: "closed",
        label: "closed",
        rows: [{ index: 1, cells: table.rows[1] }],
      },
    ]);
  });

  it("humanizes nested API column names", () => {
    expect(humanizeViewColumn("author.login")).toBe("Login");
    expect(humanizeViewColumn("created_at")).toBe("Created At");
  });
});
