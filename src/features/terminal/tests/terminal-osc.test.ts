import { describe, expect, it } from "vite-plus/test";
import { parseOsc7Directory } from "../utils/terminal-osc";

describe("OSC 7 directory reports", () => {
  it("decodes the path from a file URL with or without a host", () => {
    expect(parseOsc7Directory("file://host/Users/mehmet/My%20Project")).toBe(
      "/Users/mehmet/My Project",
    );
    expect(parseOsc7Directory("file:///tmp/project")).toBe("/tmp/project");
  });

  it("normalises Windows drive paths reported by PowerShell", () => {
    expect(parseOsc7Directory("file://DESKTOP/C:/Users/mehmet/project")).toBe(
      "C:/Users/mehmet/project",
    );
  });

  it("keeps undecodable paths and rejects non-file payloads", () => {
    expect(parseOsc7Directory("file:///bad%zz")).toBe("/bad%zz");
    expect(parseOsc7Directory("https://example.com/path")).toBeNull();
    expect(parseOsc7Directory("file://hostonly")).toBeNull();
  });
});
