import { describe, expect, it } from "vite-plus/test";
import { __test__ } from "../utils/window-open-request";

const { parseWindowOpenUrl } = __test__;

describe("parseWindowOpenUrl", () => {
  it("parses file with line number", () => {
    const url = new URL("athas://open?path=/Users/test/foo.txt&line=42");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/foo.txt",
      isDirectory: false,
      line: 42,
    });
  });

  it("parses file with line and column params", () => {
    const url = new URL("athas://open?path=/Users/test/foo.txt&line=42&column=7");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/foo.txt",
      isDirectory: false,
      line: 42,
      column: 7,
    });
  });

  it("parses line column pairs from the line param", () => {
    const url = new URL("athas://open?path=/Users/test/foo.txt&line=42:7");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/foo.txt",
      isDirectory: false,
      line: 42,
      column: 7,
    });
  });

  it("parses directory", () => {
    const url = new URL("athas://open?path=/Users/test/project&type=directory");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/project",
      isDirectory: true,
      line: undefined,
    });
  });

  it("parses file without line", () => {
    const url = new URL("athas://open?path=/Users/test/foo.txt");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/foo.txt",
      isDirectory: false,
      line: undefined,
    });
  });

  it("parses in-app query based window requests", () => {
    const url = new URL("http://localhost/?target=open&type=directory&path=/Users/test/project");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/project",
      isDirectory: true,
      line: undefined,
    });
  });

  it("parses remote window requests", () => {
    const url = new URL(
      "http://localhost/?target=open&type=remote&connectionId=conn-1&name=My%20Server",
    );
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "remote",
      remoteConnectionId: "conn-1",
      remoteConnectionName: "My Server",
    });
  });

  it("parses web viewer requests", () => {
    const url = new URL("athas://open?type=web&url=https%3A%2F%2Fathas.dev%2Fdocs");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "web",
      url: "https://athas.dev/docs",
    });
  });

  it("parses terminal requests", () => {
    const url = new URL(
      "athas://open?type=terminal&command=npm%20test&cwd=%2FUsers%2Ftest%2Fproject",
    );
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "terminal",
      command: "npm test",
      workingDirectory: "/Users/test/project",
    });
  });

  it("returns null when path is missing", () => {
    const url = new URL("athas://open");
    expect(parseWindowOpenUrl(url)).toBeNull();
  });

  it("returns null for non-open host", () => {
    const url = new URL("athas://extension/install/foo");
    expect(parseWindowOpenUrl(url)).toBeNull();
  });

  it("ignores line=0", () => {
    const url = new URL("athas://open?path=/foo.txt&line=0");
    const result = parseWindowOpenUrl(url);
    expect(result?.line).toBeUndefined();
  });

  it("ignores column without a valid line", () => {
    const url = new URL("athas://open?path=/foo.txt&line=0&column=7");
    const result = parseWindowOpenUrl(url);
    expect(result?.line).toBeUndefined();
    expect(result?.column).toBeUndefined();
  });
});
