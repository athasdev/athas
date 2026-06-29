import { describe, expect, test } from "vite-plus/test";
import type { FileEntry } from "../types/app.types";
import {
  addFileToTree,
  removeFileFromTree,
  updateFileInTree,
} from "../controllers/file-tree-utils";

const createTree = (): FileEntry[] => [
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
            name: "index.ts",
            path: "/root/src/index.ts",
            isDir: false,
          },
        ],
      },
      {
        name: "README.md",
        path: "/root/README.md",
        isDir: false,
      },
    ],
  },
];

describe("file tree mutation helpers", () => {
  test("updateFileInTree preserves references when the target is missing", () => {
    const tree = createTree();
    const result = updateFileInTree(tree, "/root/missing.ts", (file) => ({
      ...file,
      name: "changed.ts",
    }));

    expect(result).toBe(tree);
  });

  test("updateFileInTree only clones ancestors of the updated file", () => {
    const tree = createTree();
    const root = tree[0]!;
    const src = root.children?.[0];
    const readme = root.children?.[1];
    const result = updateFileInTree(tree, "/root/src/index.ts", (file) => ({
      ...file,
      name: "main.ts",
    }));

    expect(result).not.toBe(tree);
    expect(result[0]).not.toBe(root);
    expect(result[0]!.children?.[0]).not.toBe(src);
    expect(result[0]!.children?.[1]).toBe(readme);
  });

  test("removeFileFromTree preserves references when the target is missing", () => {
    const tree = createTree();
    const result = removeFileFromTree(tree, "/root/missing.ts");

    expect(result).toBe(tree);
  });

  test("addFileToTree only clones the insertion branch", () => {
    const tree = createTree();
    const readme = tree[0]!.children?.[1];
    const result = addFileToTree(tree, "/root/src", {
      name: "main.ts",
      path: "/root/src/main.ts",
      isDir: false,
    });

    expect(result).not.toBe(tree);
    expect(result[0]).not.toBe(tree[0]);
    expect(result[0]!.children?.[0]).not.toBe(tree[0]!.children?.[0]);
    expect(result[0]!.children?.[1]).toBe(readme);
  });

  test("addFileToTree preserves references when the parent is missing", () => {
    const tree = createTree();
    const result = addFileToTree(tree, "/root/missing", {
      name: "main.ts",
      path: "/root/missing/main.ts",
      isDir: false,
    });

    expect(result).toBe(tree);
  });
});
