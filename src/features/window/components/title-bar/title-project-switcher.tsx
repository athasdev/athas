import { useAddProjectItems } from "@/features/layout/hooks/use-add-project-items";
import { activateProject } from "@/features/layout/services/project-view";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  type MenuItem,
  menuSeparator,
} from "@/ui/dropdown";
import { ChevronDownIcon } from "@/ui/icons";

/** The project in front, in the title bar, with every open project and the ways to add one. */
export function TitleProjectSwitcher() {
  const projects = useWorkspaceTabsStore((state) => state.projectTabs);
  const isSwitchingProject = useFileSystemStore((state) => state.isSwitchingProject);
  const addProjectItems = useAddProjectItems();
  const active = projects.find((project) => project.isActive);
  const items: MenuItem[] = [
    ...projects.map((project): MenuItem => ({
      id: project.id,
      label: project.name,
      checked: project.isActive,
      onClick: () => void activateProject(project.id),
    })),
    ...(projects.length > 0 ? [menuSeparator("add-project")] : []),
    ...addProjectItems,
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            disabled={isSwitchingProject}
            aria-label={active ? `Project ${active.name}, switch project` : "Open a project"}
            tooltip="Switch Project"
          />
        }
      >
        <span className="min-w-0 truncate">{active?.name ?? "Open project"}</span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="default">
        <DropdownMenuItems items={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
