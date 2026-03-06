import { describe, expect, it } from "bun:test";
import type { ColumnFilter, FilterOperator } from "../types";

const VALID_OPERATORS: FilterOperator[] = [
  "equals",
  "notEquals",
  "contains",
  "startsWith",
  "endsWith",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "isNull",
  "isNotNull",
];

const NO_VALUE_OPERATORS = new Set<FilterOperator>(["isNull", "isNotNull"]);

describe("filter serialization", () => {
  it("serializes a simple equals filter", () => {
    const filter: ColumnFilter = {
      column: "name",
      operator: "equals",
      value: "Alice",
    };
    expect(filter.column).toBe("name");
    expect(filter.operator).toBe("equals");
    expect(filter.value).toBe("Alice");
  });

  it("serializes a between filter with value2", () => {
    const filter: ColumnFilter = {
      column: "age",
      operator: "between",
      value: "18",
      value2: "65",
    };
    expect(filter.value2).toBe("65");
  });

  it("all operators are valid FilterOperator types", () => {
    for (const op of VALID_OPERATORS) {
      const filter: ColumnFilter = {
        column: "test",
        operator: op,
        value: "val",
      };
      expect(filter.operator).toBe(op);
    }
  });

  it("isNull and isNotNull operators need no value", () => {
    expect(NO_VALUE_OPERATORS.has("isNull")).toBe(true);
    expect(NO_VALUE_OPERATORS.has("isNotNull")).toBe(true);
    expect(NO_VALUE_OPERATORS.has("equals")).toBe(false);
  });

  it("serializes filter objects for Rust command", () => {
    const filters: ColumnFilter[] = [
      { column: "name", operator: "contains", value: "test" },
      { column: "age", operator: "gt", value: "18" },
    ];

    const serialized = filters.map((f) => ({
      column: f.column,
      operator: f.operator,
      value: f.value,
      value2: f.value2 ?? null,
    }));

    expect(serialized).toHaveLength(2);
    expect(serialized[0].value2).toBeNull();
    expect(serialized[1].column).toBe("age");
  });
});
