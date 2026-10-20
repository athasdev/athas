import { getProjectToolPaneId } from "@/features/layout/services/dock-pane-registry";
import { runPaneCommand } from "@/features/layout/services/pane-commands";
import { ArrowClockwiseIcon } from "@/ui/icons";
import { SidebarIconButton } from "@/ui/sidebar";
import type { GitSidebarAction } from "../types/git.types";

/** The Source Control pane header's action: reload the repository's status and history. */
export function GitPaneActions() {
  return (
    <SidebarIconButton
      tooltip="Refresh"
      aria-label="Refresh source control"
      onClick={() =>
        void runPaneCommand(getProjectToolPaneId("git"), "action", {
          type: "refresh",
        } satisfies GitSidebarAction)
      }
    >
      <ArrowClockwiseIcon />
    </SidebarIconButton>
  );
}
