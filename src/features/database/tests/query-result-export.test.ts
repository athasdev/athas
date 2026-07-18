import { describe, expect, it } from "vite-plus/test";
import {
  buildQueryResultExportFilename,
  queryResultRowsToObjects,
  serializeQueryResultToJson,
  serializeQueryResultToCsv,
} from "@/features/database/lib/query-result-export";

describe("query result export", () => {
  it("serializes query results to CSV with escaped headers and values", () => {
    expect(
      serializeQueryResultToCsv({
        columns: ["id", 'display"name', "profile"],
        rows: [
          [1, 'Alice "A"', { role: "admin" }],
          [2, null, undefined],
        ],
      }),
    ).toBe(
      [
        '"id","display""name","profile"',
        '"1","Alice ""A""","{""role"":""admin""}"',
        '"2","",""',
      ].join("\n"),
    );
  });

  it("falls back when object values cannot be JSON serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(
      serializeQueryResultToCsv({
        columns: ["payload"],
        rows: [[circular], [{ id: BigInt(1) }]],
      }),
    ).toBe(['"payload"', '"[object Object]"', '"[object Object]"'].join("\n"));
  });

  it("keeps CSV rows aligned with all result columns", () => {
    expect(
      serializeQueryResultToCsv({
        columns: ["id", "name", "email"],
        rows: [[1, "Ada"]],
      }),
    ).toBe(['"id","name","email"', '"1","Ada",""'].join("\n"));
  });

  it("uses stable CSV headers for duplicate and blank result columns", () => {
    expect(
      serializeQueryResultToCsv({
        columns: [" id ", "", "id", "column_2", ""],
        rows: [[1, 2, 3, 4, 5]],
      }),
    ).toBe(['"id","column_2","id_2","column_2_2","column_5"', '"1","2","3","4","5"'].join("\n"));
  });

  it("keeps object export aligned with result columns", () => {
    expect(
      queryResultRowsToObjects({
        columns: ["id", "name"],
        rows: [
          [1, "Alice"],
          [2, "Bob"],
        ],
      }),
    ).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("keeps duplicate column names distinct in object exports", () => {
    expect(
      queryResultRowsToObjects({
        columns: ["id", "id", " name ", "id"],
        rows: [[1, 10, "Alice", 100]],
      }),
    ).toEqual([{ id: 1, id_2: 10, name: "Alice", id_3: 100 }]);
  });

  it("uses stable fallback keys for blank object export columns", () => {
    expect(
      queryResultRowsToObjects({
        columns: ["", " ", "column_1", ""],
        rows: [[1, 2, 3, 4]],
      }),
    ).toEqual([{ column_1: 1, column_2: 2, column_1_2: 3, column_4: 4 }]);
  });

  it("serializes query results to JSON without throwing on unsupported values", () => {
    const circular: Record<string, unknown> = { name: "Circular" };
    circular.self = circular;

    expect(
      serializeQueryResultToJson({
        columns: ["id", "payload"],
        rows: [[BigInt(1), circular]],
      }),
    ).toBe(
      [
        "[",
        "  {",
        '    "id": "1",',
        '    "payload": {',
        '      "name": "Circular",',
        '      "self": "[Circular]"',
        "    }",
        "  }",
        "]",
      ].join("\n"),
    );
  });

  it("builds explicit filenames for custom query exports", () => {
    expect(
      buildQueryResultExportFilename({
        isCustomQuery: true,
        selectedTable: "users",
        date: new Date("2026-05-09T12:00:00Z"),
      }),
    ).toBe("custom_query_result_2026-05-09.csv");
  });

  it("includes page context in paginated custom query export filenames", () => {
    expect(
      buildQueryResultExportFilename({
        isCustomQuery: true,
        selectedTable: "users",
        page: 2,
        totalPages: 5,
        date: new Date("2026-05-09T12:00:00Z"),
      }),
    ).toBe("custom_query_result_page_2_of_5_2026-05-09.csv");
  });

  it("clamps invalid page context in custom query export filenames", () => {
    expect(
      buildQueryResultExportFilename({
        isCustomQuery: true,
        selectedTable: "users",
        page: 99,
        totalPages: 5,
        date: new Date("2026-05-09T12:00:00Z"),
      }),
    ).toBe("custom_query_result_page_5_of_5_2026-05-09.csv");
    expect(
      buildQueryResultExportFilename({
        isCustomQuery: true,
        selectedTable: "users",
        page: Number.NaN,
        totalPages: 5,
        date: new Date("2026-05-09T12:00:00Z"),
      }),
    ).toBe("custom_query_result_2026-05-09.csv");
  });

  it("sanitizes table export filenames", () => {
    expect(
      buildQueryResultExportFilename({
        isCustomQuery: false,
        selectedTable: 'public."active users"',
        date: new Date("2026-05-09T12:00:00Z"),
      }),
    ).toBe("public._active_users_2026-05-09.csv");
  });

  it("falls back for invalid export dates", () => {
    expect(
      buildQueryResultExportFilename({
        isCustomQuery: true,
        selectedTable: "users",
        date: new Date("invalid"),
      }),
    ).toBe("custom_query_result_unknown-date.csv");
  });
});
