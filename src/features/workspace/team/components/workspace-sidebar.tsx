import { useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import { PlusIcon } from "@/ui/icons";
import Select from "@/ui/select";
import {
  SidebarIconButton,
  SidebarListItem,
  SidebarScrollArea,
  SidebarSectionLabel,
  SidebarSectionStack,
  SidebarWorkspace,
} from "@/ui/sidebar";
import { getBaseName } from "@/utils/path-helpers";
import { WORKSPACE_SECTIONS } from "../config/workspace-sections";
import { useWorkspaceSelection } from "../hooks/use-workspace-selection";
import { useWorkspaceManagementStore } from "../stores/workspace-management.store";

export function WorkspaceSidebar() {
  const { root, paths, drafts } = useWorkspaceSelection();
  const section = useWorkspaceManagementStore.use.section();
  const { register, select, setSection } = useWorkspaceManagementStore.use.actions();
  const enterprise = useAuthStore((state) => state.subscription?.enterprise?.has_access);
  const isManagementActive = useBufferStore(
    (state) =>
      state.buffers.find((buffer) => buffer.id === state.activeBufferId)?.type === "workspaces",
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const openDetails = () => useBufferStore.getState().actions.openContent({ type: "workspaces" });
  const add = async () => {
    setActionError(null);
    try {
      const path = await openFolder();
      if (path) {
        register(path);
        openDetails();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <SidebarWorkspace
      title="Workspaces"
      actions={
        <SidebarIconButton
          aria-label="Add workspace"
          tooltip="Add workspace"
          onClick={() => void add()}
        >
          <PlusIcon />
        </SidebarIconButton>
      }
    >
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
        {actionError ? (
          <p role="alert" className="mt-2 text-destructive ui-text-sm">
            {actionError}
          </p>
        ) : null}
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
            onClick={() => useUIState.getState().openSettingsDialog("enterprise")}
          >
            Organization controls
          </Button>
        ) : null}
      </SidebarScrollArea>
    </SidebarWorkspace>
  );
}
