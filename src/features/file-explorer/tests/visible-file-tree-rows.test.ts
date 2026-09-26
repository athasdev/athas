import { describe, expect, test } from "vite-plus/test";
import {
  buildVisibleFileTreeRows,
  collectFileTreeSearchHits,
  filterFileTreeEntries,
  filterFileTreeForFffHits,
  getGuideAncestorRows,
  getStickyAncestorRows,
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
  test("sorts each directory once and keeps the order stable across rebuilds", () => {
    const files = [
      {
        name: "root",
        path: "/root",
        isDir: true,
        children: [
          { name: "b.ts", path: "/root/b.ts", isDir: false },
          { name: "src", path: "/root/src", isDir: true, children: [] },
          { name: "A.ts", path: "/root/A.ts", isDir: false },
        ],
      },
    ];
    const expanded = new Set(["/root"]);
    const first = buildVisibleFileTreeRows(files, expanded).map((row) => row.file.name);
    const second = buildVisibleFileTreeRows(files, expanded).map((row) => row.file.name);

    expect(first).toEqual(["root", "src", "A.ts", "b.ts"]);
    expect(second).toEqual(first);
    expect(
      buildVisibleFileTreeRows(files, expanded, { sortOrder: "name" }).map((row) => row.file.name),
    ).toEqual(["root", "A.ts", "b.ts", "src"]);
  });

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

  test("sorts folders first by default and can mix entries by name", () => {
    const entries = [
      { name: "beta.ts", path: "/beta.ts", isDir: false },
      { name: "zeta", path: "/zeta", isDir: true, children: [] },
      { name: "alpha.ts", path: "/alpha.ts", isDir: false },
    ];

    expect(buildVisibleFileTreeRows(entries, new Set()).map((row) => row.file.name)).toEqual([
      "zeta",
      "alpha.ts",
      "beta.ts",
    ]);
    expect(
      buildVisibleFileTreeRows(entries, new Set(), { sortOrder: "name" }).map(
        (row) => row.file.name,
      ),
    ).toEqual(["alpha.ts", "beta.ts", "zeta"]);
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

  test("finds the full sticky ancestor stack for a visible descendant", () => {
    const rows = buildVisibleFileTreeRows(
      tree,
      new Set(["/root", "/root/src", "/root/src/features", "/root/src/features/file-explorer"]),
    );

    expect(getStickyAncestorRows(rows, 4).map((row) => row.file.path)).toEqual([
      "/root",
      "/root/src",
      "/root/src/features",
      "/root/src/features/file-explorer",
    ]);
    expect(getStickyAncestorRows(rows, 0)).toEqual([]);
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

  test("filters only the directories that changed when given a cache", () => {
    const checkedPaths: string[] = [];
    const options = {
      ...baseOptions,
      isGitIgnored: (path: string) => {
        checkedPaths.push(path);
        return false;
      },
    };
    const cache = new WeakMap();
    filterFileTreeEntries(tree, options, cache);
    const firstPassChecks = checkedPaths.length;

    const addedFile = { name: "README.md", path: "/root/README.md", isDir: false };
    const updatedTree = [{ ...tree[0]!, children: [...(tree[0]!.children ?? []), addedFile] }];
    checkedPaths.length = 0;
    filterFileTreeEntries(updatedTree, options, cache);

    expect(firstPassChecks).toBeGreaterThan(2);
    // The root's children are new, so they are checked; the unchanged src subtree is not.
    expect(checkedPaths).toEqual(["/root", "/root/src", "/root/README.md"]);
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

  test("synthesizes fff hits missing from the loaded tree", () => {
    const result = filterFileTreeForFffHits(tree, [{ path: "/root/src/generated/new-file.ts" }], {
      rootPath: "/root",
    });
    const rows = buildVisibleFileTreeRows(result.files, result.expandedPaths);

    expect(rows.map((row) => row.file.path)).toEqual([
      "/root",
      "/root/src",
      "/root/src/generated",
      "/root/src/generated/new-file.ts",
    ]);
    expect(Array.from(result.matchedPaths)).toEqual(["/root/src/generated/new-file.ts"]);
    expect(result.orderedMatchedPaths).toEqual(["/root/src/generated/new-file.ts"]);
    expect(result.matchCount).toBe(1);
  });
});
