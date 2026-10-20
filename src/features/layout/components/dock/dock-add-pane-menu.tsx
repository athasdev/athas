import type { ReactNode } from "react";
import {
  type DockPaneDefinition,
  getDockPanes,
} from "@/features/layout/services/dock-pane-registry";
import { selectDockLayout, useDockLayoutStore } from "@/features/layout/stores/dock-layout.store";
import type { DockOwner, DockPaneId } from "@/features/layout/types/dock.types";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { PlusIcon } from "@/ui/icons";
import { useProjectTools } from "./project-tools";

const alwaysAvailable = () => true;

function PaneItem({
  owner,
  pane,
  title,
  icon,
}: {
  owner: DockOwner;
  pane: DockPaneId;
  title: string;
  icon: ReactNode;
}) {
  const open = useDockLayoutStore((state) => selectDockLayout(state, owner).panes.includes(pane));
  const { open: openPane, close } = useDockLayoutStore.use.actions();
  return (
    <DropdownMenuCheckboxItem
      checked={open}
      onCheckedChange={(checked) =>
        checked ? openPane(owner, pane, { focus: true }) : close(owner, pane)
      }
    >
      {icon}
      {title}
    </DropdownMenuCheckboxItem>
  );
}

function SessionPaneItem({ owner, pane }: { owner: DockOwner; pane: DockPaneDefinition }) {
  const useAvailable = pane.useAvailable ?? alwaysAvailable;
  if (!useAvailable(owner)) return null;
  return <PaneItem owner={owner} pane={pane.id} title={pane.title} icon={pane.icon} />;
}

/**
 * The `+` in the dock: every tool the owner's dock can hold, checked while it is open. A session's
 * dock lists its own tools first, then the project's.
 */
export function DockAddPaneMenu({ owner }: { owner: DockOwner }) {
  const projectTools = useProjectTools();
  const sessionPanes = getDockPanes().filter(
    (pane) => pane.scope === "any" || owner.kind === "session",
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" iconOnly aria-label="Add pane" tooltip="Add pane" />
        }
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="default">
        {sessionPanes.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Session</DropdownMenuLabel>
            {sessionPanes.map((pane) => (
              <SessionPaneItem key={pane.id} owner={owner} pane={pane} />
            ))}
          </DropdownMenuGroup>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Project</DropdownMenuLabel>
          {projectTools.map((tool) => (
            <PaneItem
              key={tool.paneId}
              owner={owner}
              pane={tool.paneId}
              title={tool.title}
              icon={tool.icon}
            />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
