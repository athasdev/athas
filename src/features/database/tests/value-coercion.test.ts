import { describe, expect, it } from "vite-plus/test";
import {
  buildDatabaseRowValues,
  coerceDatabaseValue,
  databaseRowToFormValues,
} from "../utils/value-coercion";

describe("coerceDatabaseValue", () => {
  it("returns null for empty values", () => {
    expect(coerceDatabaseValue("", "TEXT")).toBeNull();
    expect(coerceDatabaseValue("   ", "INTEGER")).toBeNull();
  });

  it("coerces integer columns", () => {
    expect(coerceDatabaseValue("42", "INTEGER")).toBe(42);
    expect(coerceDatabaseValue(" 42 ", "INTEGER")).toBe(42);
    expect(coerceDatabaseValue("-42", "INTEGER")).toBe(-42);
  });

  it("leaves unsafe integer values untouched", () => {
    expect(coerceDatabaseValue("9007199254740993", "BIGINT")).toBe("9007199254740993");
    expect(coerceDatabaseValue("-9007199254740993", "INTEGER")).toBe("-9007199254740993");
  });

  it("coerces floating-point columns", () => {
    expect(coerceDatabaseValue("3.14", "REAL")).toBe(3.14);
    expect(coerceDatabaseValue("2.5", "FLOAT")).toBe(2.5);
    expect(coerceDatabaseValue(" 2.5 ", "FLOAT")).toBe(2.5);
    expect(coerceDatabaseValue("-2.5", "FLOAT")).toBe(-2.5);
  });

  it("leaves malformed numeric values untouched", () => {
    expect(coerceDatabaseValue("12abc", "INTEGER")).toBe("12abc");
    expect(coerceDatabaseValue("1.2.3", "REAL")).toBe("1.2.3");
  });

  it("leaves text values untouched", () => {
    expect(coerceDatabaseValue("Alice", "TEXT")).toBe("Alice");
  });
});

describe("databaseRowToFormValues", () => {
  it("keeps edit form values in string input shape", () => {
    expect(
      databaseRowToFormValues({
        id: 7,
        name: "Ada",
        active: true,
        notes: null,
        missing: undefined,
      }),
    ).toEqual({
      id: "7",
      name: "Ada",
      active: "true",
      notes: "",
      missing: "",
    });
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
