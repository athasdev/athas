import { ProjectGlyph } from "@/features/workspace/project-icons/components/project-glyph";
import type { ProjectTab } from "@/features/workspace/stores/workspace-tabs.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { ChevronExpandYIcon } from "@/ui/icons";

interface AgentProjectPickerProps {
  projects: readonly ProjectTab[];
  value: ProjectTab;
  onChange: (projectId: string) => void;
}

/** Picks which open project a new agent session starts in. */
export function AgentProjectPicker({ projects, value, onChange }: AgentProjectPickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            truncate
            aria-label={`Start the agent in a project. Current project: ${value.name}`}
            title={value.path}
          >
            <ProjectGlyph projectPath={value.path} iconPath={value.customIcon} />
            <span className="min-w-0 truncate">{value.name}</span>
            <ChevronExpandYIcon className="text-subtle-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent side="bottom" align="center" size="default">
        <DropdownMenuRadioGroup value={value.id} onValueChange={onChange}>
          {projects.map((project) => (
            <DropdownMenuRadioItem key={project.id} value={project.id} closeOnClick>
              <ProjectGlyph projectPath={project.path} iconPath={project.customIcon} />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
