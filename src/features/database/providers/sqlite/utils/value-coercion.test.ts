import { describe, expect, it } from "bun:test";
import { buildDatabaseRowValues, coerceDatabaseValue } from "./value-coercion";

describe("coerceDatabaseValue", () => {
  it("returns null for empty values", () => {
    expect(coerceDatabaseValue("", "TEXT")).toBeNull();
  });

  it("coerces integer columns", () => {
    expect(coerceDatabaseValue("42", "INTEGER")).toBe(42);
  });

  it("coerces floating-point columns", () => {
    expect(coerceDatabaseValue("3.14", "REAL")).toBe(3.14);
    expect(coerceDatabaseValue("2.5", "FLOAT")).toBe(2.5);
  });

  it("leaves text values untouched", () => {
    expect(coerceDatabaseValue("Alice", "TEXT")).toBe("Alice");
  });
});

describe("buildDatabaseRowValues", () => {
  it("coerces values using the matching column metadata", () => {
    const values = {
      id: "7",
      price: "19.99",
      name: "Widget",
      notes: "",
    };

    const columns = [
      { name: "id", type: "INTEGER", notnull: true, primary_key: true, default_value: null },
      { name: "price", type: "REAL", notnull: false, primary_key: false, default_value: null },
      { name: "name", type: "TEXT", notnull: true, primary_key: false, default_value: null },
      { name: "notes", type: "TEXT", notnull: false, primary_key: false, default_value: null },
    ];

    expect(buildDatabaseRowValues(values, columns)).toEqual({
      id: 7,
      price: 19.99,
      name: "Widget",
      notes: null,
    });
  });
});
