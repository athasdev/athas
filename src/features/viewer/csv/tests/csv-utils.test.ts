import { describe, expect, it } from "vite-plus/test";
import { parseCsv } from "../lib/csv-utils";

describe("parseCsv", () => {
  it("parses quoted delimiters, escaped quotes, and CRLF rows", () => {
    expect(parseCsv('name,notes\r\nAthas,"fast, focused"\r\nEditor,"says ""hi"""')).toEqual({
      headers: ["name", "notes"],
      rows: [
        ["Athas", "fast, focused"],
        ["Editor", 'says "hi"'],
      ],
    });
  });

  it("generates headers and pads short rows when no header is present", () => {
    expect(parseCsv("one;two\nthree", ";", false)).toEqual({
      headers: ["Column 1", "Column 2"],
      rows: [
        ["one", "two"],
        ["three", ""],
      ],
    });
  });

  it("keeps trailing empty fields", () => {
    expect(parseCsv("first,last\nAthas,", ",", true)).toEqual({
      headers: ["first", "last"],
      rows: [["Athas", ""]],
    });
  });
});
