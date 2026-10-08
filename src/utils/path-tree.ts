interface PathTreeNodeBase<T> {
  id: string;
  name: string;
  path: string;
  children: PathTreeNode<T>[];
}

export interface PathTreeBranch<T> extends PathTreeNodeBase<T> {
  type: "branch";
}

export interface PathTreeLeaf<T> extends PathTreeNodeBase<T> {
  type: "leaf";
  item: T;
}

export type PathTreeNode<T> = PathTreeBranch<T> | PathTreeLeaf<T>;

export interface CompactPathTreeBranch<T> {
  branch: PathTreeBranch<T>;
  label: string;
}

interface PathTreeBuildNode<T> extends PathTreeBranch<T> {
  branches: Map<string, PathTreeBuildNode<T>>;
}

interface BuildPathTreeOptions<T> {
  getKey: (item: T) => string;
  getPath: (item: T) => string;
}

function createBranch<T>(name: string, path: string): PathTreeBuildNode<T> {
  return {
    id: `branch:${path}`,
    name,
    path,
    type: "branch",
    children: [],
    branches: new Map(),
  };
}

function getPathSegments(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function sortPathTree<T>(nodes: PathTreeNode<T>[]): void {
  nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === "branch" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortPathTree(node.children);
}

export function buildPathTree<T>(
  items: T[],
  { getKey, getPath }: BuildPathTreeOptions<T>,
): PathTreeNode<T>[] {
  const root = createBranch<T>("", "");

  for (const item of items) {
    const itemPath = getPath(item);
    const segments = getPathSegments(itemPath);
    if (segments.length === 0) continue;

    let current = root;
    let currentPath = "";
    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let branch = current.branches.get(segment);
      if (!branch) {
        branch = createBranch(segment, currentPath);
        current.branches.set(segment, branch);
        current.children.push(branch);
      }
      current = branch;
    }

    current.children.push({
      id: `leaf:${getKey(item)}`,
      name: segments[segments.length - 1],
      path: itemPath,
      type: "leaf",
      children: [],
      item,
    });
  }

  sortPathTree(root.children);
  return root.children;
}

export function compactPathTreeBranch<T>(branch: PathTreeBranch<T>): CompactPathTreeBranch<T> {
  const names = [branch.name];
  let compactedBranch = branch;

  while (compactedBranch.children.length === 1) {
    const child = compactedBranch.children[0];
    if (!child || child.type !== "branch") break;

    compactedBranch = child;
    names.push(child.name);
  }

  return {
    branch: compactedBranch,
    label: names.join("/"),
  };
}
