import { describe, expect, it } from "vite-plus/test";
import { parseTerminalFileLinks } from "../utils/terminal-file-links";

describe("terminal file links", () => {
  it("resolves workspace-relative paths from Codex output", () => {
    const links = parseTerminalFileLinks(
      "Edited src/features/file-system/stores/recent-files.store.ts (+5 -2)",
      "/Users/me/project",
    );

    expect(links).toEqual([
      {
        text: "src/features/file-system/stores/recent-files.store.ts",
        path: "/Users/me/project/src/features/file-system/stores/recent-files.store.ts",
        line: undefined,
        column: undefined,
        startIndex: 7,
        endIndex: 60,
      },
    ]);
  });

  it("keeps line and column suffixes on relative paths", () => {
    const links = parseTerminalFileLinks("src/app/main.tsx:42:7", "/repo");

    expect(links[0]).toMatchObject({
      text: "src/app/main.tsx:42:7",
      path: "/repo/src/app/main.tsx",
      line: 42,
      column: 7,
    });
  });

  it("supports absolute file uri and trims surrounding punctuation", () => {
    const links = parseTerminalFileLinks("`file:///Users/me/project/src/app.ts:12`.", "/repo");

    expect(links[0]).toMatchObject({
      text: "file:///Users/me/project/src/app.ts:12",
      path: "/Users/me/project/src/app.ts",
      line: 12,
    });
  });

  it("supports remote and wsl provider paths", () => {
    const links = parseTerminalFileLinks(
      "remote://prod/home/me/app/src/index.ts wsl://Ubuntu/home/me/app/main.py:3",
      undefined,
    );

    expect(links.map((link) => [link.path, link.line])).toEqual([
      ["remote://prod/home/me/app/src/index.ts", undefined],
      ["wsl://Ubuntu/home/me/app/main.py", 3],
    ]);
  });

  it("maps absolute remote terminal paths into the remote workspace provider", () => {
    const links = parseTerminalFileLinks(
      "/home/me/app/src/index.ts:15",
      "remote://conn-1/home/me/app",
    );

    expect(links[0]).toMatchObject({
      path: "remote://conn-1/home/me/app/src/index.ts",
      line: 15,
    });
  });

  it("maps absolute WSL terminal paths into the WSL workspace provider", () => {
    const links = parseTerminalFileLinks(
      "/home/me/app/src/index.ts:15",
      "wsl://Ubuntu/home/me/app",
    );

    expect(links[0]).toMatchObject({
      path: "wsl://Ubuntu/home/me/app/src/index.ts",
      line: 15,
    });
  });

  it("supports Windows absolute paths without treating the drive as a line suffix", () => {
    const links = parseTerminalFileLinks("C:\\repo\\src\\main.ts:9:2", "/repo");

    expect(links[0]).toMatchObject({
      path: "C:\\repo\\src\\main.ts",
      line: 9,
      column: 2,
    });
  });

  it("ignores web urls and prose words", () => {
    const links = parseTerminalFileLinks(
      "recent-files fallback https://example.com/src/main.ts",
      "/repo",
    );

    expect(links).toEqual([]);
  });
});
