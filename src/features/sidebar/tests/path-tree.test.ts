import { describe, expect, test } from "vite-plus/test";
import { buildPathTree } from "../lib/path-tree";

describe("buildPathTree", () => {
  test("builds one sorted hierarchy from mixed path separators", () => {
    const tree = buildPathTree(
      [
        { key: "z", path: "src\\z.ts" },
        { key: "a", path: "src/components/a.ts" },
        { key: "readme", path: "README.md" },
      ],
      {
        getKey: (item) => item.key,
        getPath: (item) => item.path,
      },
    );

    expect(tree.map((node) => [node.type, node.name])).toEqual([
      ["branch", "src"],
      ["leaf", "README.md"],
    ]);
    expect(tree[0].children.map((node) => [node.type, node.name])).toEqual([
      ["branch", "components"],
      ["leaf", "z.ts"],
    ]);
    expect(tree[0].children[0].children[0]).toMatchObject({
      id: "leaf:a",
      name: "a.ts",
      path: "src/components/a.ts",
    });
  });

  test("keeps duplicate paths addressable by their domain keys", () => {
    const tree = buildPathTree(
      [
        { key: "staged", path: "src/app.ts" },
        { key: "unstaged", path: "src/app.ts" },
      ],
      {
        getKey: (item) => item.key,
        getPath: (item) => item.path,
      },
    );

    expect(tree[0].children.map((node) => node.id)).toEqual(["leaf:staged", "leaf:unstaged"]);
  });
});
