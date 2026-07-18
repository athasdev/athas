import { describe, expect, it } from "vite-plus/test";
import { formatQueryResultSummary } from "@/features/database/lib/query-result-summary";

describe("query result summary", () => {
  it("describes table result rows", () => {
    expect(formatQueryResultSummary({ isCustomQuery: false, rowCount: 0 })).toBe("0 visible rows");
    expect(formatQueryResultSummary({ isCustomQuery: false, rowCount: 1 })).toBe("1 visible row");
    expect(formatQueryResultSummary({ isCustomQuery: false, rowCount: 12 })).toBe(
      "12 visible rows",
    );
  });

  it("describes single-page custom query results", () => {
    expect(formatQueryResultSummary({ isCustomQuery: true, rowCount: 1, totalPages: 1 })).toBe(
      "1 query row",
    );
  });

  it("includes page context for paginated custom query results", () => {
    expect(
      formatQueryResultSummary({
        isCustomQuery: true,
        rowCount: 50,
        currentPage: 2,
        totalPages: 5,
      }),
    ).toBe("50 visible query rows on page 2 of 5");
  });

  it("normalizes invalid pagination summary inputs", () => {
    expect(
      formatQueryResultSummary({
        isCustomQuery: true,
        rowCount: Number.NaN,
        currentPage: 99,
        totalPages: 5.9,
      }),
    ).toBe("0 visible query rows on page 5 of 5");
  });
});
