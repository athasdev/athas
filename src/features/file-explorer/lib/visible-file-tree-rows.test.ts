import { describe, expect, test } from "vitest";
import { buildVisibleFileTreeRows } from "./visible-file-tree-rows";

const tree = [
  {
    name: "root",
    path: "/root",
    isDir: true,
    children: [
      {
        name: "src",
        path: "/root/src",
        isDir: true,
        children: [
          {
            name: "features",
            path: "/root/src/features",
            isDir: true,
            children: [
              {
                name: "file-explorer",
                path: "/root/src/features/file-explorer",
                isDir: true,
                children: [
                  {
                    name: "file-tree.tsx",
                    path: "/root/src/features/file-explorer/file-tree.tsx",
                    isDir: false,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

describe("buildVisibleFileTreeRows", () => {
  test("shows only the expanded root branch", () => {
    const rows = buildVisibleFileTreeRows(tree, new Set(["/root"]));

    expect(rows.map((row) => row.file.path)).toEqual(["/root", "/root/src"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1]);
  });

  test("shows third-level rows when parent folders are expanded", () => {
    const rows = buildVisibleFileTreeRows(
      tree,
      new Set(["/root", "/root/src", "/root/src/features"]),
    );

    expect(rows.map((row) => row.file.path)).toEqual([
      "/root",
      "/root/src",
      "/root/src/features",
      "/root/src/features/file-explorer",
    ]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3]);
  });

  test("shows deeper descendants once every ancestor is expanded", () => {
    const rows = buildVisibleFileTreeRows(
      tree,
      new Set(["/root", "/root/src", "/root/src/features", "/root/src/features/file-explorer"]),
    );

    expect(rows.map((row) => row.file.path)).toEqual([
      "/root",
      "/root/src",
      "/root/src/features",
      "/root/src/features/file-explorer",
      "/root/src/features/file-explorer/file-tree.tsx",
    ]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3, 4]);
  });

  test("hides nested descendants when a middle folder collapses", () => {
    const rows = buildVisibleFileTreeRows(tree, new Set(["/root", "/root/src"]));

    expect(rows.map((row) => row.file.path)).toEqual(["/root", "/root/src", "/root/src/features"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2]);
  });
});
