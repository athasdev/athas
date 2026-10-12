import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

interface Entry {
  name: string;
  isDirectory: boolean;
}

const fs = vi.hoisted(() => ({
  tree: new Map<string, Entry[] | Error>(),
  ensureAssetAccess: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(async (path: string) => {
    const entries = fs.tree.get(path);
    if (entries instanceof Error) throw entries;
    return entries ?? [];
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));
vi.mock("@/utils/asset-access", () => ({ ensureAssetAccess: fs.ensureAssetAccess }));

import { readDir } from "@tauri-apps/plugin-fs";
import { findBestProjectIcon, scanProjectIconFiles } from "../project-icons/services/project-icons";

const file = (name: string): Entry => ({ name, isDirectory: false });
const dir = (name: string): Entry => ({ name, isDirectory: true });

beforeEach(() => {
  fs.tree.clear();
  vi.mocked(readDir).mockClear();
  fs.ensureAssetAccess.mockClear();
});

describe("scanProjectIconFiles", () => {
  it("ranks app icons above incidental images and skips build output", async () => {
    fs.tree.set("/repo", [
      file("README.md"),
      file("logo.svg"),
      dir("src-tauri"),
      dir("public"),
      dir("docs"),
      dir("node_modules"),
      dir(".git"),
      dir("dist"),
      { name: "", isDirectory: false },
    ]);
    fs.tree.set("/repo/src-tauri", [dir("icons")]);
    fs.tree.set("/repo/src-tauri/icons", [file("icon.png"), file("mask-icon.svg")]);
    fs.tree.set("/repo/public", [file("favicon.ico"), file("photo.png")]);
    fs.tree.set("/repo/docs", [file("logo.png")]);
    fs.tree.set("/repo/node_modules", [file("icon.png")]);

    const icons = await scanProjectIconFiles("/repo");

    expect(fs.ensureAssetAccess).toHaveBeenCalledWith("/repo");
    expect(icons.map((icon) => icon.path)).toEqual([
      "/repo/public/favicon.ico",
      "/repo/src-tauri/icons/icon.png",
      "/repo/logo.svg",
      "/repo/src-tauri/icons/mask-icon.svg",
      "/repo/docs/logo.png",
    ]);
    expect(icons[1]).toMatchObject({
      name: "icon.png",
      src: `asset://localhost/${encodeURIComponent("/repo/src-tauri/icons/icon.png")}`,
    });
    const visited = vi.mocked(readDir).mock.calls.map(([path]) => path);
    expect(visited).not.toContain("/repo/node_modules");
    expect(visited).not.toContain("/repo/.git");
    expect(visited).not.toContain("/repo/dist");
  });

  it("stops descending after four levels", async () => {
    fs.tree.set("/r", [dir("a")]);
    fs.tree.set("/r/a", [dir("b")]);
    fs.tree.set("/r/a/b", [dir("c")]);
    fs.tree.set("/r/a/b/c", [dir("d")]);
    fs.tree.set("/r/a/b/c/d", [dir("e"), file("icon.svg")]);
    fs.tree.set("/r/a/b/c/d/e", [file("icon.png")]);

    const icons = await scanProjectIconFiles("/r");

    expect(icons.map((icon) => icon.path)).toEqual(["/r/a/b/c/d/icon.svg"]);
  });

  it("skips unreadable folders and keeps Windows separators", async () => {
    fs.tree.set("C:\\repo", [dir("locked"), dir("assets"), file("app-icon.png")]);
    fs.tree.set("C:\\repo\\locked", new Error("EACCES"));
    fs.tree.set("C:\\repo\\assets", [file("icon-512.png"), file("apple-touch-icon.png")]);

    const icons = await scanProjectIconFiles("C:\\repo");

    expect(icons.map((icon) => icon.path)).toEqual([
      "C:\\repo\\app-icon.png",
      "C:\\repo\\assets\\icon-512.png",
      "C:\\repo\\assets\\apple-touch-icon.png",
    ]);
  });

  it("orders icons from best to worst score", async () => {
    fs.tree.set("/p", [dir("a"), dir("b")]);
    fs.tree.set("/p/a", [file("icon-192.png")]);
    fs.tree.set("/p/b", [dir("c"), file("logo-dark.png")]);
    fs.tree.set("/p/b/c", [file("logo-light.png")]);

    const icons = await scanProjectIconFiles("/p");

    expect(icons[0].path).toBe("/p/a/icon-192.png");
    expect(icons.map((icon) => icon.score)).toEqual(
      icons.map((icon) => icon.score).sort((left, right) => right - left),
    );
  });
});

describe("findBestProjectIcon", () => {
  it("returns the top ranked icon or null", async () => {
    fs.tree.set("/app", [file("favicon.ico"), file("banner.png")]);

    await expect(findBestProjectIcon("/app")).resolves.toMatchObject({ name: "favicon.ico" });
    await expect(findBestProjectIcon("/empty")).resolves.toBeNull();
  });
});
