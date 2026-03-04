import { describe, expect, it } from "bun:test";
import { __test__ } from "./open-request";

const { parseOpenUrl } = __test__;

describe("parseOpenUrl", () => {
  it("parses file with line number", () => {
    const url = new URL("athas://open?path=/Users/test/foo.txt&line=42");
    const result = parseOpenUrl(url);
    expect(result).toEqual({
      path: "/Users/test/foo.txt",
      isDirectory: false,
      line: 42,
    });
  });

  it("parses directory", () => {
    const url = new URL("athas://open?path=/Users/test/project&type=directory");
    const result = parseOpenUrl(url);
    expect(result).toEqual({
      path: "/Users/test/project",
      isDirectory: true,
      line: undefined,
    });
  });

  it("parses file without line", () => {
    const url = new URL("athas://open?path=/Users/test/foo.txt");
    const result = parseOpenUrl(url);
    expect(result).toEqual({
      path: "/Users/test/foo.txt",
      isDirectory: false,
      line: undefined,
    });
  });

  it("returns null when path is missing", () => {
    const url = new URL("athas://open");
    expect(parseOpenUrl(url)).toBeNull();
  });

  it("returns null for non-open host", () => {
    const url = new URL("athas://extension/install/foo");
    expect(parseOpenUrl(url)).toBeNull();
  });

  it("ignores line=0", () => {
    const url = new URL("athas://open?path=/foo.txt&line=0");
    const result = parseOpenUrl(url);
    expect(result?.line).toBeUndefined();
  });
});
