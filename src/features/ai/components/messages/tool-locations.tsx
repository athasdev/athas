import { FileTextIcon } from "@/ui/icons";
import type { AcpToolCallLocation } from "@/features/ai/types/acp.types";
import { toRelativeDisplayPath } from "@/features/ai/lib/acp-diff-output";
import {
  createAcpToolLocationTree,
  getToolLocationActionArgs,
  OPEN_TOOL_LOCATION_COMMAND,
} from "@/features/ai/lib/acp-tool-location-tree";
import { openToolPath } from "@/features/ai/lib/open-tool-location";
import { ExtensionViewRenderer } from "@/extensions/ui/components/extension-view-renderer";
import { Button } from "@/ui/button";

/**
 * The files an ACP tool call touches: one location is a `path:line` link, several are a tree.
 * Either opens the file at the reported line.
 */
export function ToolLocations({
  locations,
  rootFolderPath,
}: {
  locations: AcpToolCallLocation[];
  rootFolderPath?: string | null;
}) {
  const tree = createAcpToolLocationTree(locations);
  if (tree) {
    return (
      <ExtensionViewRenderer
        node={tree}
        execute={(action) => {
          const target = getToolLocationActionArgs(action.args);
          if (action.command === OPEN_TOOL_LOCATION_COMMAND && target) {
            return openToolPath(target.path, target.line);
          }
        }}
        surface="embedded"
      />
    );
  }
  const [location] = locations;
  if (!location?.path) return null;
  const path = toRelativeDisplayPath(location.path, rootFolderPath);
  return (
    <div className="flex min-w-0">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        truncate
        tooltip="Open file"
        onClick={() => void openToolPath(location.path, location.line)}
      >
        <FileTextIcon />
        <span className="font-mono">{location.line ? `${path}:${location.line}` : path}</span>
      </Button>
    </div>
  );
}
