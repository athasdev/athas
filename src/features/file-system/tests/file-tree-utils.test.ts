import { describe, expect, test } from "vite-plus/test";
import type { FileEntry } from "../types/app.types";
import {
  addFileToTree,
  findFileInTree,
  isPathInsideTreeEntry,
  relocateFileEntry,
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

  test("isPathInsideTreeEntry matches whole path segments with either separator", () => {
    expect(isPathInsideTreeEntry("/root/src/index.ts", "/root/src")).toBe(true);
    expect(isPathInsideTreeEntry("/root/src/", "/root/src")).toBe(true);
    expect(isPathInsideTreeEntry("/root/src", "/root/src")).toBe(false);
    expect(isPathInsideTreeEntry("/root/srcs/index.ts", "/root/src")).toBe(false);
    expect(isPathInsideTreeEntry("C:\\repo\\src\\a.ts", "C:\\repo")).toBe(true);
    expect(isPathInsideTreeEntry("/a.ts", "/")).toBe(true);
    expect(isPathInsideTreeEntry("remote://c1/home/a.ts", "remote://c1/home")).toBe(true);
  });

  test("tree walks only descend into the branch that can contain the target", () => {
    const tree = createTree();
    const untouched: FileEntry = {
      name: "lib",
      path: "/root/lib",
      isDir: true,
      get children(): FileEntry[] {
        throw new Error("walked into an unrelated branch");
      },
    };
    tree[0]!.children!.push(untouched);

    expect(findFileInTree(tree, "/root/src/index.ts")?.name).toBe("index.ts");
    expect(findFileInTree(tree, "/root/src/missing.ts")).toBeNull();
    expect(
      updateFileInTree(tree, "/root/src/index.ts", (file) => ({ ...file, name: "main.ts" }))[0]!
        .children?.[2],
    ).toBe(untouched);
    expect(removeFileFromTree(tree, "/root/src/index.ts")[0]!.children?.[2]).toBe(untouched);
    expect(
      addFileToTree(tree, "/root/src", { name: "b.ts", path: "/root/src/b.ts", isDir: false })[0]!
        .children?.[2],
    ).toBe(untouched);
  });

  test("finds inline placeholder entries whose path ends with a separator", () => {
    const tree = addFileToTree(createTree(), "/root/src", {
      name: "",
      path: "/root/src/",
      isDir: false,
      isNewItem: true,
    });

    expect(findFileInTree(tree, "/root/src/")?.isNewItem).toBe(true);
  });

  test("renaming a loaded directory moves its descendants under the new path", () => {
    const tree = updateFileInTree(createTree(), "/root/src", (item) =>
      relocateFileEntry(item, "/root/lib", "lib"),
    );

    expect(findFileInTree(tree, "/root/src/index.ts")).toBeNull();
    expect(findFileInTree(tree, "/root/lib/index.ts")?.name).toBe("index.ts");
    expect(findFileInTree(tree, "/root/lib/index.ts")).not.toHaveProperty("children");
    expect(
      findFileInTree(removeFileFromTree(tree, "/root/lib/index.ts"), "/root/lib")?.children,
    ).toEqual([]);
  });

  test("moving a loaded directory keeps its descendants reachable for later updates", () => {
    const tree = createTree();
    tree[0]!.children!.push({ name: "pkg", path: "/root/pkg", isDir: true, children: [] });
    const moved = relocateFileEntry(findFileInTree(tree, "/root/src")!, "/root/pkg/src", "src");
    const updated = addFileToTree(removeFileFromTree(tree, "/root/src"), "/root/pkg", moved);

    expect(findFileInTree(updated, "/root/pkg/src/index.ts")?.path).toBe("/root/pkg/src/index.ts");
    expect(
      findFileInTree(
        updateFileInTree(updated, "/root/pkg/src/index.ts", (file) => ({ ...file, name: "x.ts" })),
        "/root/pkg/src/index.ts",
      )?.name,
    ).toBe("x.ts");
  });
});
