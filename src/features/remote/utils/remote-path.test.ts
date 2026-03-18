import { describe, expect, it } from "vite-plus/test";
import { buildRemoteRootPath, isRemotePath, parseRemotePath } from "./remote-path";

describe("remote-path utils", () => {
  it("parses a remote workspace root path", () => {
    expect(parseRemotePath("remote://conn-123/")).toEqual({
      connectionId: "conn-123",
      remotePath: "/",
    });
  });

  it("parses a nested remote file path", () => {
    expect(parseRemotePath("remote://conn-123/home/me/project/src/lib.rs")).toEqual({
      connectionId: "conn-123",
      remotePath: "/home/me/project/src/lib.rs",
    });
  });

  it("detects remote paths", () => {
    expect(isRemotePath("remote://abc/")).toBe(true);
    expect(isRemotePath("/Users/me/project")).toBe(false);
  });

  it("builds a remote root path", () => {
    expect(buildRemoteRootPath("conn-123")).toBe("remote://conn-123/");
  });
});
