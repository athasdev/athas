import { Button } from "@/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";
import { Item, ItemContent, ItemTitle, ItemDescription } from "@/ui/item";
import { useWorkspaceManagementStore } from "../stores/workspace-management.store";
import type { WorkspaceSectionProps } from "./workspace-section-props";

export function WorkspaceOverview({ root, config, onChange }: WorkspaceSectionProps) {
  const bindings = useWorkspaceManagementStore((state) => state.bindings[root]);
  const { setSection } = useWorkspaceManagementStore.use.actions();
  const missing = (config.repositories ?? []).filter((repo) => !bindings?.[repo.id]).length;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 @min-[700px]/workbench-content:grid-cols-3">
        <Card variant="muted">
          <CardHeader>
            <CardTitle>Repositories</CardTitle>
            <CardDescription>
              {1 + (config.repositories?.length ?? 0)} projects in this workspace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="ghost" onClick={() => setSection("repositories")}>
              {missing ? `${missing} need a local folder` : "Manage repositories"}
            </Button>
          </CardContent>
        </Card>
        <Card variant="muted">
          <CardHeader>
            <CardTitle>Shared tasks</CardTitle>
            <CardDescription>{config.commands.length} commands for the team</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="ghost" onClick={() => setSection("tasks")}>
              Manage tasks
            </Button>
          </CardContent>
        </Card>
        <Card variant="muted">
          <CardHeader>
            <CardTitle>Extensions</CardTitle>
            <CardDescription>
              {config.recommendedExtensions?.length ?? 0} team recommendations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="ghost" onClick={() => setSection("extensions")}>
              Review extensions
            </Button>
          </CardContent>
        </Card>
      </div>
      <Field>
        <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
        <Input
          id="workspace-name"
          value={config.name}
          maxLength={120}
          onChange={(event) => onChange({ ...config, name: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="workspace-description">Description</FieldLabel>
        <Textarea
          id="workspace-description"
          rows={3}
          maxLength={2000}
          value={config.description ?? ""}
          placeholder="What this team builds and how these projects fit together."
          onChange={(event) => onChange({ ...config, description: event.target.value })}
        />
      </Field>
      <Item variant="muted">
        <ItemContent>
          <ItemTitle>Shared with your repository</ItemTitle>
          <ItemDescription>
            Save and commit athas.workspace.json to share tasks, AI instructions, repositories and
            extension recommendations. Local folder mappings stay on this device.
          </ItemDescription>
        </ItemContent>
      </Item>
      <FieldDescription className="break-all">Workspace root: {root}</FieldDescription>
    </div>
  );
}
