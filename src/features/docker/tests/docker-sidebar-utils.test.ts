import { describe, expect, it } from "vite-plus/test";
import {
  formatDockerFileSize,
  getDockerDebugCommand,
  getDockerExecCommand,
  getDockerFileName,
  getDockerImageReference,
  getDockerUnavailableCopy,
  getParentContainerPath,
  getPublishedDockerTcpUrl,
  includesDockerQuery,
  isDockerConnectionError,
  isDockerErrorLogLine,
  splitDockerConfigLines,
} from "../utils/docker-sidebar-utils";

describe("Docker sidebar utilities", () => {
  it("classifies connection failures and produces actionable copy", () => {
    expect(isDockerConnectionError("Cannot connect to the Docker daemon")).toBe(true);
    expect(getDockerUnavailableCopy("Docker CLI was not found")).toMatchObject({
      title: "Docker CLI isn't available",
    });
    expect(getDockerUnavailableCopy("unexpected response")).toMatchObject({
      title: "Docker is unavailable",
    });
  });

  it("builds shell-safe exec and debug commands", () => {
    expect(getDockerExecCommand("container'id")).toContain("'container'\\''id'");
    expect(getDockerDebugCommand("abc", "npm test", "/work dir")).toBe(
      "docker exec -it 'abc' sh -lc 'cd '\\''/work dir'\\'' && npm test'",
    );
  });

  it("resolves published TCP ports without treating internal-only ports as links", () => {
    expect(getPublishedDockerTcpUrl("0.0.0.0:8080->80/tcp")).toBe("http://localhost:8080");
    expect(getPublishedDockerTcpUrl("80/tcp")).toBeNull();
  });

  it("normalizes configuration, paths, image references, and file metadata", () => {
    expect(splitDockerConfigLines("A=1, B=2\nC=3")).toEqual(["A=1", "B=2", "C=3"]);
    expect(getParentContainerPath("/work/src/")).toBe("/work");
    expect(getDockerFileName("/work/src/main.ts")).toBe("main.ts");
    expect(formatDockerFileSize(1536)).toBe("2 KB");
    expect(
      getDockerImageReference({
        id: "sha256:abc",
        repository: "athas/app",
        tag: "latest",
        digest: "sha256:abc",
        createdSince: "now",
        size: "1 MB",
      }),
    ).toBe("athas/app:latest");
  });

  it("shares filtering and error detection semantics", () => {
    expect(includesDockerQuery(["Athas", null], "ath")).toBe(true);
    expect(isDockerErrorLogLine("worker panic: failed to start")).toBe(true);
    expect(isDockerErrorLogLine("server listening")).toBe(false);
  });
});
