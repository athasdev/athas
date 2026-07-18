import { describe, expect, it } from "vite-plus/test";
import {
  getQueryResultTotalPages,
  paginateQueryResult,
  parseQueryResultPageInput,
} from "@/features/database/lib/query-result-pagination";

describe("query result pagination", () => {
  it("calculates total pages for in-memory query results", () => {
    expect(
      getQueryResultTotalPages(
        {
          columns: ["id"],
          rows: [[1], [2], [3]],
        },
        2,
      ),
    ).toBe(2);
    expect(getQueryResultTotalPages(null, 50)).toBe(1);
  });

  it("normalizes invalid page sizes when calculating total pages", () => {
    const result = {
      columns: ["id"],
      rows: [[1], [2], [3]],
    };

    expect(getQueryResultTotalPages(result, 0)).toBe(3);
    expect(getQueryResultTotalPages(result, Number.NaN)).toBe(1);
  });

  it("caps custom query page sizes consistently with the SQL store", () => {
    const result = {
      columns: ["id"],
      rows: Array.from({ length: 501 }, (_, index) => [index]),
    };

    expect(getQueryResultTotalPages(result, 999)).toBe(2);
    expect(paginateQueryResult(result, 1, 999).rows).toHaveLength(500);
  });

  it("returns the requested page without changing the full result", () => {
    const result = {
      columns: ["id"],
      rows: [[1], [2], [3]],
    };

    expect(paginateQueryResult(result, 2, 2)).toEqual({
      columns: ["id"],
      rows: [[3]],
    });
    expect(result.rows).toEqual([[1], [2], [3]]);
  });

  it("clamps custom query pages before slicing rows", () => {
    const result = {
      columns: ["id"],
      rows: [[1], [2], [3]],
    };

    expect(paginateQueryResult(result, 99, 2)).toEqual({
      columns: ["id"],
      rows: [[3]],
    });
    expect(paginateQueryResult(result, 0, 2)).toEqual({
      columns: ["id"],
      rows: [[1], [2]],
    });
    expect(paginateQueryResult(result, 1, 0)).toEqual({
      columns: ["id"],
      rows: [[1]],
    });
  });

  it("parses page input only when it is a complete in-range integer", () => {
    expect(parseQueryResultPageInput(" 2 ", 3)).toBe(2);
    expect(parseQueryResultPageInput("2abc", 3)).toBeNull();
    expect(parseQueryResultPageInput("1.5", 3)).toBeNull();
    expect(parseQueryResultPageInput("0", 3)).toBeNull();
    expect(parseQueryResultPageInput("4", 3)).toBeNull();
    expect(parseQueryResultPageInput("2", Number.NaN)).toBeNull();
  });
});
