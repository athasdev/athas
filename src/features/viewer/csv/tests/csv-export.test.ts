import { describe, expect, it } from "vite-plus/test";
import { detectCsvDelimiter, formatCsv, parseCsv } from "../lib/csv-utils";

describe("CSV delimiter detection", () => {
  it.each([
    ["a,b,c\n1,2,3", ","],
    ["a\tb\tc\n1\t2\t3", "\t"],
    ["a;b;c\n1;2;3", ";"],
    ["a|b|c\n1|2|3", "|"],
  ])("detects the delimiter of %j", (text, delimiter) => {
    expect(detectCsvDelimiter(text)).toBe(delimiter);
  });

  it("prefers the delimiter that splits rows consistently", () => {
    expect(detectCsvDelimiter("a;b\n1,5;2\n3,5;4")).toBe(";");
  });

  it("falls back to a comma when nothing splits the text", () => {
    expect(detectCsvDelimiter("just one column")).toBe(",");
  });
});

describe("CSV export", () => {
  it("joins fields with the delimiter and includes the header when present", () => {
    expect(formatCsv(["a", "b"], [["1", "2"]], "\t")).toBe("a\tb\n1\t2");
    expect(formatCsv(null, [["1", "2"]], ";")).toBe("1;2");
  });

  it("quotes fields that contain the delimiter, quotes, or line breaks", () => {
    expect(formatCsv(null, [["fast, focused", 'says "hi"', "two\nlines", "plain"]], ",")).toBe(
      '"fast, focused","says ""hi""","two\nlines",plain',
    );
  });

  it("round-trips through the parser", () => {
    const parsed = parseCsv('name,notes\nAthas,"fast, focused"\nEditor,"says ""hi"""');

    expect(parseCsv(formatCsv(parsed.headers, parsed.rows, ","))).toEqual(parsed);
  });
});
