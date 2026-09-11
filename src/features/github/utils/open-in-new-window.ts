import { toast } from "sonner";
import type { OpenContentSpec } from "@/features/panes/types/pane-content.types";
import { openResourceInDetachedWindow } from "@/features/window/detached/detached-resource-service";

/** Shows a GitHub resource in its own bare window, next to the main workbench. */
export function openGitHubContentInNewWindow(
  repoPath: string | null | undefined,
  spec: OpenContentSpec,
) {
  if (!repoPath || repoPath.startsWith("remote://")) {
    toast.error("Opening in a new window needs a local repository.");
    return;
  }
  void openResourceInDetachedWindow(spec, repoPath);
}
