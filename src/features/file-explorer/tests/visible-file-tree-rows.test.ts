import { describe, expect, test } from "vite-plus/test";
import {
  buildVisibleFileTreeRows,
  collectFileTreeSearchHits,
  filterFileTreeEntries,
  filterFileTreeForFffHits,
  getGuideAncestorRows,
} from "../lib/visible-file-tree-rows";

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

  test("compacts expanded single-child folder chains", () => {
    const rows = buildVisibleFileTreeRows(
      tree,
      new Set(["/root", "/root/src", "/root/src/features"]),
      { compactFolders: true },
    );

    expect(rows.map((row) => row.file.path)).toEqual(["/root/src/features/file-explorer"]);
    expect(rows.map((row) => row.displayName)).toEqual(["root/src/features/file-explorer"]);
    expect(rows.map((row) => row.depth)).toEqual([0]);
  });

  test("hides a matching single project root folder", () => {
    const rows = buildVisibleFileTreeRows(tree, new Set(), { hiddenRootPath: "/root" });

    expect(rows.map((row) => row.file.path)).toEqual(["/root/src"]);
    expect(rows.map((row) => row.depth)).toEqual([0]);
  });

  test("does not hide roots in a multi-root tree", () => {
    const rows = buildVisibleFileTreeRows(
      [
        ...tree,
        {
          name: "other",
          path: "/other",
          isDir: true,
          children: [],
        },
      ],
      new Set(),
      { hiddenRootPath: "/root" },
    );

    expect(rows.map((row) => row.file.path)).toEqual(["/root", "/other"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 0]);
  });

  test("stops compacting at the collapsed folder", () => {
    const rows = buildVisibleFileTreeRows(tree, new Set(["/root", "/root/src"]), {
      compactFolders: true,
    });

    expect(rows.map((row) => row.file.path)).toEqual(["/root/src/features"]);
    expect(rows.map((row) => row.displayName)).toEqual(["root/src/features"]);
    expect(rows.map((row) => row.isExpanded)).toEqual([false]);
  });

  test("finds guide ancestors for each visible depth level", () => {
    const rows = buildVisibleFileTreeRows(
      tree,
      new Set(["/root", "/root/src", "/root/src/features", "/root/src/features/file-explorer"]),
    );

    expect(getGuideAncestorRows(rows, 4).map((row) => row?.file.path)).toEqual([
      "/root",
      "/root/src",
      "/root/src/features",
      "/root/src/features/file-explorer",
    ]);
  });
});

describe("collectFileTreeSearchHits", () => {
  test("collects matching file-tree paths in display order", () => {
    expect(collectFileTreeSearchHits(tree, "file-tree", 10)).toEqual([
      { path: "/root/src/features/file-explorer/file-tree.tsx" },
    ]);
  });

  test("limits collected matches", () => {
    expect(collectFileTreeSearchHits(tree, "src", 1)).toEqual([{ path: "/root/src" }]);
  });
});

describe("filterFileTreeEntries", () => {
  const baseOptions = {
    isAlwaysHidden: () => false,
    isGitIgnored: () => false,
    isHiddenName: () => false,
    isUserHidden: () => false,
    showGitignoredFiles: true,
    showHiddenFiles: true,
  };

  test("preserves tree references when nothing is filtered or decorated", () => {
    const result = filterFileTreeEntries(tree, baseOptions);

    expect(result).toBe(tree);
    expect(result[0]).toBe(tree[0]);
    expect(result[0]!.children?.[0]).toBe(tree[0]!.children?.[0]);
  });

  test("only clones branches affected by hidden descendants", () => {
    const result = filterFileTreeEntries(tree, {
      ...baseOptions,
      isHiddenName: (name) => name === "file-tree.tsx",
      showHiddenFiles: false,
    });

    expect(result).not.toBe(tree);
    expect(result[0]).not.toBe(tree[0]);
    expect(result[0]!.children?.[0]).not.toBe(tree[0]!.children?.[0]);
    expect(result[0]!.children?.[0].children?.[0].children?.[0].children).toEqual([]);
  });

  test("decorates ignored entries without cloning unaffected siblings", () => {
    const sibling = {
      name: "package.json",
      path: "/root/package.json",
      isDir: false,
    };
    const files = [{ ...tree[0]!, children: [...(tree[0]!.children ?? []), sibling] }];
    const result = filterFileTreeEntries(files, {
      ...baseOptions,
      isGitIgnored: (path) => path === sibling.path,
    });

    expect(result[0]).not.toBe(files[0]);
    expect(result[0]!.children?.[0]).toBe(files[0]!.children?.[0]);
    expect(result[0]!.children?.[1]).toEqual({ ...sibling, ignored: true, children: undefined });
  });
});

describe("filterFileTreeForFffHits", () => {
  test("keeps matching files with their ancestors expanded", () => {
    const result = filterFileTreeForFffHits(tree, [
      { path: "/root/src/features/file-explorer/file-tree.tsx" },
    ]);
    const rows = buildVisibleFileTreeRows(result.files, result.expandedPaths);

    expect(rows.map((row) => row.file.path)).toEqual([
      "/root",
      "/root/src",
      "/root/src/features",
      "/root/src/features/file-explorer",
      "/root/src/features/file-explorer/file-tree.tsx",
    ]);
    expect(Array.from(result.matchedPaths)).toEqual([
      "/root/src/features/file-explorer/file-tree.tsx",
    ]);
    expect(result.orderedMatchedPaths).toEqual(["/root/src/features/file-explorer/file-tree.tsx"]);
    expect(result.matchCount).toBe(1);
  });

  test("keeps a matched folder without expanding unmatched descendants", () => {
    const result = filterFileTreeForFffHits(tree, [{ path: "/root/src/features" }]);
    const rows = buildVisibleFileTreeRows(result.files, result.expandedPaths);

    expect(rows.map((row) => row.file.path)).toEqual(["/root", "/root/src", "/root/src/features"]);
    expect(Array.from(result.matchedPaths)).toEqual(["/root/src/features"]);
  });

  test("returns an empty tree for empty fff results", () => {
    const result = filterFileTreeForFffHits(tree, []);

    expect(result.files).toEqual([]);
    expect(result.matchCount).toBe(0);
    expect(result.expandedPaths.size).toBe(0);
  });
});
