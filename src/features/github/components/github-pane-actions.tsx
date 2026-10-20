import { getProjectToolPaneId } from "@/features/layout/services/dock-pane-registry";
import { runPaneCommand } from "@/features/layout/services/pane-commands";
import { ArrowClockwiseIcon } from "@/ui/icons";
import { SidebarIconButton } from "@/ui/sidebar";
import type { GitHubSidebarAction } from "../types/github.types";

/** The GitHub pane header's action: reload the section on screen. */
export function GitHubPaneActions() {
  return (
    <SidebarIconButton
      tooltip="Refresh"
      aria-label="Refresh GitHub"
      onClick={() =>
        void runPaneCommand(getProjectToolPaneId("github-prs"), "action", {
          type: "refresh",
        } satisfies GitHubSidebarAction)
      }
    >
      <ArrowClockwiseIcon />
    </SidebarIconButton>
  );
}
