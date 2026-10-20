import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { Button } from "@/ui/button";
import { PlusIcon } from "@/ui/icons";
import Select from "@/ui/select";
import {
  SidebarIconButton,
  SidebarListItem,
  SidebarScrollArea,
  SidebarSectionLabel,
  SidebarSectionStack,
  SidebarPanel,
} from "@/ui/sidebar";
import { getBaseName } from "@/utils/path-helpers";
import { showToast } from "@/utils/toast";
import { openFolder } from "@/features/file-system/api/file-system-api";
import { WORKSPACE_SECTIONS } from "../config/workspace-sections";
import { useWorkspaceSelection } from "../hooks/use-workspace-selection";
import { useWorkspaceManagementStore } from "../stores/workspace-management.store";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";

export function WorkspaceSidebar() {
  const { root, paths, drafts } = useWorkspaceSelection();
  const section = useWorkspaceManagementStore.use.section();
  const { select, setSection } = useWorkspaceManagementStore.use.actions();
  const enterprise = useAuthStore((state) => state.subscription?.enterprise?.has_access);
  const activeBufferId = useActiveBufferId();
  const isManagementActive = useBufferStore(
    (state) => state.buffers.find((buffer) => buffer.id === activeBufferId)?.type === "workspaces",
  );
  const openDetails = () => openWorkspaceDetails();

  return (
    <SidebarPanel>
      <SidebarScrollArea>
        <Select
          aria-label="Workspace"
          width="full"
          searchable
          value={root ?? ""}
          options={paths.map((path) => ({
            value: path,
            label: drafts[path]?.config.name || getBaseName(path),
            keywords: [path],
          }))}
          onChange={(path) => {
            select(path);
            openDetails();
          }}
          placeholder="Choose a workspace"
        />
        <nav aria-label="Workspace sections">
          <SidebarSectionStack>
            {WORKSPACE_SECTIONS.map((group) => (
              <section key={group.id}>
                <SidebarSectionLabel>{group.label}</SidebarSectionLabel>
                {group.items.map((item) => (
                  <SidebarListItem
                    key={item.id}
                    active={isManagementActive && section === item.id}
                    leading={item.icon}
                    aria-current={isManagementActive && section === item.id ? "page" : undefined}
                    onClick={() => {
                      setSection(item.id);
                      openDetails();
                    }}
                  >
                    {item.label}
                  </SidebarListItem>
                ))}
              </section>
            ))}
          </SidebarSectionStack>
        </nav>
        {enterprise ? (
          <Button
            variant="ghost"
            width="full"
            onClick={() => useUIState.getState().openSettings("enterprise")}
          >
            Organization controls
          </Button>
        ) : null}
      </SidebarScrollArea>
    </SidebarPanel>
  );
}

function openWorkspaceDetails() {
  useBufferStore.getState().actions.openContent({ type: "workspaces" });
}

/** The Workspaces pane header's action: register a folder as a workspace and open its details. */
export function WorkspaceHeaderActions() {
  const { register } = useWorkspaceManagementStore.use.actions();
  const add = async () => {
    try {
      const path = await openFolder();
      if (!path) return;
      register(path);
      openWorkspaceDetails();
    } catch (error) {
      showToast({
        message: `Could not add the workspace: ${error instanceof Error ? error.message : String(error)}`,
        type: "error",
      });
    }
  };
  return (
    <SidebarIconButton
      aria-label="Add workspace"
      tooltip="Add workspace"
      onClick={() => void add()}
    >
      <PlusIcon />
    </SidebarIconButton>
  );
}
