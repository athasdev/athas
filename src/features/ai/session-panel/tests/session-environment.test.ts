import { describe, expect, it } from "vite-plus/test";
import {
  describeSessionEnvironment,
  elidePathMiddle,
  shortenHomePath,
} from "../services/session-environment";

describe("session environment", () => {
  it("writes the home folder as ~", () => {
    expect(shortenHomePath("/Users/me/code/app")).toBe("~/code/app");
    expect(shortenHomePath("/home/me")).toBe("~");
    expect(shortenHomePath("C:\\Users\\me\\code")).toBe("~\\code");
    expect(shortenHomePath("/srv/app")).toBe("/srv/app");
  });

  it("leaves out the middle of a long path, keeping its start and last two folders", () => {
    expect(elidePathMiddle("~/a/b", 36)).toBe("~/a/b");
    expect(elidePathMiddle("~/Documents/Git/athasdev/athas/packages/app", 20)).toBe(
      "~/…/packages/app",
    );
    expect(elidePathMiddle("/very/long/path/to/the/project", 12)).toBe("/very/…/the/project");
  });

  it("describes a local project", () => {
    expect(describeSessionEnvironment("/Users/me/code/athas")).toEqual({
      name: "athas",
      displayPath: "~/code/athas",
      location: { kind: "local" },
    });
  });

  it("names the host of a remote project after its connection", () => {
    expect(describeSessionEnvironment("remote://conn-1/home/me/app", "build-box")).toEqual({
      name: "app",
      displayPath: "~/app",
      location: { kind: "remote", host: "build-box" },
    });
  });

  it("names the distro of a WSL project", () => {
    expect(describeSessionEnvironment("wsl://Ubuntu/home/me/app")).toEqual({
      name: "app",
      displayPath: "~/app",
      location: { kind: "wsl", distro: "Ubuntu" },
    });
  });
});
