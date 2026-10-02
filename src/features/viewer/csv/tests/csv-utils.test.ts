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

  it("keeps line breaks inside quoted fields", () => {
    expect(parseCsv('id,note\n1,"line one\nline two"\n2,plain')).toEqual({
      headers: ["id", "note"],
      rows: [
        ["1", "line one\nline two"],
        ["2", "plain"],
      ],
    });
  });

  it("splits on tab and pipe delimiters without touching commas", () => {
    expect(parseCsv("a\tb\n1,5\t2", "\t").rows).toEqual([["1,5", "2"]]);
    expect(parseCsv("a|b\nx|y", "|").rows).toEqual([["x", "y"]]);
  });

  it("ignores a trailing newline instead of adding an empty row", () => {
    expect(parseCsv("a,b\n1,2\n").rows).toEqual([["1", "2"]]);
  });

  it("keeps extra cells on rows wider than the header", () => {
    expect(parseCsv("a\n1,2,3").rows).toEqual([["1", "2", "3"]]);
  });

  it("returns an empty table for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});
