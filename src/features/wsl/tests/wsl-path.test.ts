import { describe, expect, it } from "vite-plus/test";
import {
  buildWslPath,
  getWslDisplayPath,
  getWslShellId,
  isWslPath,
  joinWslPath,
  normalizeWslLinuxPath,
  parseWslPath,
  resolveWslTargetPath,
} from "../utils/wsl-path";

describe("wsl path utils", () => {
  it("parses WSL roots and nested paths", () => {
    expect(parseWslPath("wsl://Ubuntu")).toEqual({
      distro: "Ubuntu",
      linuxPath: "/",
    });
    expect(parseWslPath("wsl://Ubuntu/home/me/project")).toEqual({
      distro: "Ubuntu",
      linuxPath: "/home/me/project",
    });
  });

  it("normalizes Linux paths", () => {
    expect(normalizeWslLinuxPath("home/me/project/")).toBe("/home/me/project");
    expect(normalizeWslLinuxPath("/home/me/../project/./src")).toBe("/home/project/src");
    expect(normalizeWslLinuxPath("~")).toBe("/");
  });

  it("builds and joins WSL paths", () => {
    expect(buildWslPath("Ubuntu", "home/me")).toBe("wsl://Ubuntu/home/me");
    expect(joinWslPath("wsl://Ubuntu/home/me", "src")).toBe("wsl://Ubuntu/home/me/src");
  });

  it("detects display and shell ids", () => {
    expect(isWslPath("wsl://Ubuntu/home")).toBe(true);
    expect(isWslPath("/home")).toBe(false);
    expect(getWslShellId("Ubuntu")).toBe("wsl:Ubuntu");
    expect(getWslDisplayPath("wsl://Ubuntu/home")).toBe("Ubuntu:/home");
  });

  it("resolves WSL symlink targets inside the same distribution", () => {
    expect(resolveWslTargetPath("wsl://Ubuntu/home/me/project/link", "/opt/sdk")).toBe(
      "wsl://Ubuntu/opt/sdk",
    );
    expect(resolveWslTargetPath("wsl://Ubuntu/home/me/project/link", "../shared")).toBe(
      "wsl://Ubuntu/home/me/shared",
    );
  });
});
