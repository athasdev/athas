import { describe, expect, it } from "vite-plus/test";
import { getProjectIconOptions, type ProjectIconFile } from "../utils/project-icons";

const icons: ProjectIconFile[] = [
  { name: "icon.png", path: "/project/src-tauri/icons/icon.png", src: "asset://icon", score: 200 },
  { name: "logo.svg", path: "/project/public/logo.svg", src: "asset://logo", score: 100 },
  { name: "logo.svg", path: "/project/docs/logo.svg", src: "asset://docs-logo", score: 10 },
];

describe("project icon command options", () => {
  it("preserves discovery ranking and exposes paths for duplicate filenames", () => {
    const options = getProjectIconOptions(icons, "/project", "");
    expect(options.map((icon) => icon.path)).toEqual(icons.map((icon) => icon.path));
    expect(options.map((icon) => icon.relativePath)).toEqual([
      "src-tauri/icons/icon.png",
      "public/logo.svg",
      "docs/logo.svg",
    ]);
    expect(options[0].src).toBe("asset://icon");
  });

  it("searches filenames and project-relative directories case-insensitively", () => {
    expect(getProjectIconOptions(icons, "/project", "LOGO").map((icon) => icon.path)).toEqual([
      icons[1].path,
      icons[2].path,
    ]);
    expect(getProjectIconOptions(icons, "/project", "src-tauri").map((icon) => icon.path)).toEqual([
      icons[0].path,
    ]);
    expect(getProjectIconOptions(icons, "/project", "missing")).toEqual([]);
    expect(getProjectIconOptions(icons, "/project", "  ")).toHaveLength(3);
  });

  it("handles trailing separators and Windows paths", () => {
    expect(getProjectIconOptions(icons, "/project/", "")[0].relativePath).toBe(
      "src-tauri/icons/icon.png",
    );
    expect(
      getProjectIconOptions(
        [{ ...icons[0], path: "C:\\project\\public\\icon.png" }],
        "C:\\project\\",
        "public",
      )[0].relativePath,
    ).toBe("public/icon.png");
  });

  it("does not trim a different directory with the same prefix", () => {
    const options = getProjectIconOptions(
      [{ ...icons[0], path: "/project-other/icon.png" }],
      "/project",
      "",
    );
    expect(options[0].relativePath).toBe("/project-other/icon.png");
  });
});
