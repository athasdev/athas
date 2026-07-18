import { describe, expect, it } from "vite-plus/test";
import { getSelectedSqlText } from "@/features/database/lib/sql-selection";

describe("sql selection", () => {
  it("trims the selected SQL range", () => {
    expect(getSelectedSqlText("select 1;\n select 2; ", 10, 21)).toBe("select 2;");
  });

  it("returns an empty string when no SQL is selected", () => {
    expect(getSelectedSqlText("select 1", 3, 3)).toBe("");
  });

  it("normalizes reversed selection ranges", () => {
    expect(getSelectedSqlText("select 1;\nselect 2;", 19, 10)).toBe("select 2;");
  });

  it("clamps selection ranges to the SQL text", () => {
    expect(getSelectedSqlText("select 1", -10, 99)).toBe("select 1");
  });
});
