import type { AcpToolCallLocation } from "@/features/ai/types/acp.types";
import type {
  ExtensionViewNode,
  ExtensionViewTreeItem,
} from "@/extensions/ui/types/extension-view";

export const OPEN_TOOL_LOCATION_COMMAND = "athas.ai.openToolLocation";

interface MutableTreeItem extends ExtensionViewTreeItem {
  children: MutableTreeItem[];
}

const MAX_LOCATION_ITEMS = 20;
const MAX_PATH_SEGMENTS = 10;

function pathSegments(path: string): string[] {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length <= MAX_PATH_SEGMENTS) return segments;
  return [
    ...segments.slice(0, 4),
    "…",
    ...segments.slice(segments.length - (MAX_PATH_SEGMENTS - 5)),
  ];
}

function findBranch(items: MutableTreeItem[], id: string): MutableTreeItem | undefined {
  return items.find((item) => item.id === id);
}

export function createAcpToolLocationTree(
  locations: AcpToolCallLocation[],
): Extract<ExtensionViewNode, { type: "tree" }> | undefined {
  const uniqueLocations = locations
    .filter(
      (location, index) =>
        locations.findIndex(
          (candidate) => candidate.path === location.path && candidate.line === location.line,
        ) === index,
    )
    .slice(0, MAX_LOCATION_ITEMS);
  if (uniqueLocations.length < 2) return undefined;

  const items: MutableTreeItem[] = [];
  for (const [locationIndex, location] of uniqueLocations.entries()) {
    const segments = pathSegments(location.path);
    if (segments.length === 0) continue;

    let siblings = items;
    let branchPath = "";
    for (const segment of segments.slice(0, -1)) {
      branchPath = branchPath ? `${branchPath}/${segment}` : segment;
      const id = `directory:${branchPath}`;
      let branch = findBranch(siblings, id);
      if (!branch) {
        branch = {
          id,
          title: segment,
          icon: "folder",
          expanded: true,
          children: [],
        };
        siblings.push(branch);
      }
      siblings = branch.children;
    }

    const fileName = segments[segments.length - 1] ?? location.path;
    siblings.push({
      id: `location:${locationIndex}:${location.path}:${location.line ?? ""}`,
      title: fileName,
      description: segments.length === 1 ? undefined : location.path,
      meta: location.line ? `line ${location.line}` : undefined,
      icon: "file-text",
      onSelect: { command: OPEN_TOOL_LOCATION_COMMAND, args: [location.path] },
      children: [],
    });
  }

  return items.length > 0 ? { type: "tree", label: "Tool locations", items } : undefined;
}
