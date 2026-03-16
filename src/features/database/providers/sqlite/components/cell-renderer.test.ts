import { describe, expect, it } from "vite-plus/test";
import { formatCellValue } from "../hooks/use-cell-copy";
import { isIsoDate, isJsonString, isUnixTimestamp } from "./cell-renderer";

describe("cell-renderer detection heuristics", () => {
  describe("isIsoDate", () => {
    it("detects full ISO 8601 dates", () => {
      expect(isIsoDate("2024-01-15T10:30:00Z")).toBe(true);
      expect(isIsoDate("2024-01-15T10:30:00.000Z")).toBe(true);
      expect(isIsoDate("2024-01-15T10:30:00+05:30")).toBe(true);
      expect(isIsoDate("2024-01-15T10:30:00-07:00")).toBe(true);
    });

    it("detects date-only strings", () => {
      expect(isIsoDate("2024-01-15")).toBe(true);
      expect(isIsoDate("2024-12-31")).toBe(true);
    });

    it("detects datetime without timezone", () => {
      expect(isIsoDate("2024-01-15T10:30")).toBe(true);
      expect(isIsoDate("2024-01-15T10:30:00")).toBe(true);
    });

    it("rejects non-date strings", () => {
      expect(isIsoDate("hello world")).toBe(false);
      expect(isIsoDate("12345")).toBe(false);
      expect(isIsoDate("2024/01/15")).toBe(false);
      expect(isIsoDate("")).toBe(false);
      expect(isIsoDate("not-a-date")).toBe(false);
    });

    it("rejects strings that are too short or too long", () => {
      expect(isIsoDate("2024-01")).toBe(false);
      expect(isIsoDate("a".repeat(31))).toBe(false);
    });
  });

  describe("isUnixTimestamp", () => {
    it("detects valid timestamps", () => {
      expect(isUnixTimestamp(1705320000)).toBe(true); // 2024-01-15
      expect(isUnixTimestamp(946684800)).toBe(true); // 2000-01-01 (lower bound)
    });

    it("rejects out-of-range numbers", () => {
      expect(isUnixTimestamp(0)).toBe(false);
      expect(isUnixTimestamp(-1)).toBe(false);
      expect(isUnixTimestamp(100)).toBe(false);
      expect(isUnixTimestamp(5000000000)).toBe(false);
    });
  });

  describe("isJsonString", () => {
    it("detects valid JSON objects", () => {
      expect(isJsonString('{"key": "value"}')).toBe(true);
      expect(isJsonString('{"a": 1, "b": 2}')).toBe(true);
    });

    it("detects valid JSON arrays", () => {
      expect(isJsonString("[1, 2, 3]")).toBe(true);
      expect(isJsonString('["a", "b"]')).toBe(true);
    });

    it("rejects non-JSON strings", () => {
      expect(isJsonString("hello")).toBe(false);
      expect(isJsonString("123")).toBe(false);
      expect(isJsonString("")).toBe(false);
      expect(isJsonString("a")).toBe(false);
    });

    it("rejects invalid JSON with correct delimiters", () => {
      expect(isJsonString("{invalid}")).toBe(false);
      expect(isJsonString("[not,json]")).toBe(false);
    });
  });
});

describe("formatCellValue", () => {
  it("formats null as NULL string", () => {
    expect(formatCellValue(null)).toBe("NULL");
    expect(formatCellValue(undefined)).toBe("NULL");
  });

  it("formats strings directly", () => {
    expect(formatCellValue("hello")).toBe("hello");
    expect(formatCellValue("")).toBe("");
  });

  it("formats numbers as strings", () => {
    expect(formatCellValue(42)).toBe("42");
    expect(formatCellValue(3.14)).toBe("3.14");
  });

  it("formats objects as pretty JSON", () => {
    expect(formatCellValue({ key: "value" })).toBe('{\n  "key": "value"\n}');
  });

  it("formats arrays as pretty JSON", () => {
    expect(formatCellValue([1, 2, 3])).toBe("[\n  1,\n  2,\n  3\n]");
  });
});
