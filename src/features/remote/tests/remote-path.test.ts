import { describe, expect, it } from "vite-plus/test";
import {
  buildRemoteEntryPath,
  buildRemoteRootPath,
  isRemotePath,
  parseRemotePath,
} from "../services/remote-path";

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

  it("builds entry paths with a single separator after the connection id", () => {
    expect(buildRemoteEntryPath("conn-123", "/home/me")).toBe("remote://conn-123/home/me");
    expect(buildRemoteEntryPath("conn-123", "//bin")).toBe("remote://conn-123/bin");
    expect(buildRemoteEntryPath("conn-123", "/srv//app/src")).toBe("remote://conn-123/srv/app/src");
  });
});
