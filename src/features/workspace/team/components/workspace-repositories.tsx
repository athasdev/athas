import { openUrl } from "@tauri-apps/plugin-opener";
import { openFolder } from "@/features/file-system/controllers/platform";
import { Button } from "@/ui/button";
import { Field, FieldLabel, FieldDescription } from "@/ui/field";
import { Card, CardContent } from "@/ui/card";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from "@/ui/item";
import Input from "@/ui/input";
import { getBaseName } from "@/utils/path-helpers";
import { useWorkspaceManagementStore } from "../stores/workspace-management.store";
import { openManagedWorkspace } from "../services/open-managed-workspace";
import { parseTeamWorkspace } from "../utils/team-workspace-config";
import type { WorkspaceSectionProps } from "./workspace-section-props";

export function WorkspaceRepositories({
  root,
  config,
  onChange,
  reportError,
}: WorkspaceSectionProps) {
  const bindings = useWorkspaceManagementStore((state) => state.bindings[root]);
  const { bindRepository } = useWorkspaceManagementStore.use.actions();
  const repositories = config.repositories ?? [];
  const link = async (id: string) => {
    try {
      const path = await openFolder();
      if (path) bindRepository(root, id, path);
    } catch (error) {
      reportError(error);
    }
  };
  return (
    <div className="space-y-5">
      <Item variant="muted">
        <ItemContent>
          <ItemTitle>{getBaseName(root)}</ItemTitle>
          <ItemDescription className="break-all">Primary project · {root}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            variant="ghost"
            onClick={() => void openManagedWorkspace(root).catch(reportError)}
          >
            Open
          </Button>
        </ItemActions>
      </Item>
      <FieldDescription>
        Add the projects your team works on together. Each teammate links their own checkout;
        absolute paths are never written to the shared profile.
      </FieldDescription>
      {repositories.map((repo, index) => (
        <Card key={repo.id} variant="muted">
          <CardContent className="space-y-4">
            <div className="grid gap-4 @min-[700px]/workbench-content:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`repo-name-${repo.id}`}>Name</FieldLabel>
                <Input
                  id={`repo-name-${repo.id}`}
                  value={repo.name}
                  onChange={(event) =>
                    onChange({
                      ...config,
                      repositories: repositories.map((entry, i) =>
                        i === index ? { ...entry, name: event.target.value } : entry,
                      ),
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`repo-url-${repo.id}`}>Repository URL</FieldLabel>
                <Input
                  id={`repo-url-${repo.id}`}
                  value={repo.url ?? ""}
                  placeholder="https://github.com/team/project"
                  onChange={(event) =>
                    onChange({
                      ...config,
                      repositories: repositories.map((entry, i) =>
                        i === index ? { ...entry, url: event.target.value } : entry,
                      ),
                    })
                  }
                />
              </Field>
            </div>
            <FieldDescription className="break-all">
              {bindings?.[repo.id] || "No checkout linked on this device."}
            </FieldDescription>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void link(repo.id)}>
                {bindings?.[repo.id] ? "Change folder" : "Link local folder"}
              </Button>
              <Button
                variant="ghost"
                disabled={!bindings?.[repo.id]}
                onClick={() => void openManagedWorkspace(bindings![repo.id]!).catch(reportError)}
              >
                Open project
              </Button>
              {repo.url ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    try {
                      const validated = parseTeamWorkspace(JSON.stringify(config));
                      const url = validated.repositories?.[index]?.url;
                      if (url) void openUrl(url).catch(reportError);
                    } catch (error) {
                      reportError(error);
                    }
                  }}
                >
                  View repository
                </Button>
              ) : null}
              <Button
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...config,
                    repositories: repositories.filter((entry) => entry.id !== repo.id),
                  })
                }
              >
                Remove from workspace
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button
        disabled={repositories.length >= 40}
        onClick={() =>
          onChange({
            ...config,
            repositories: [...repositories, { id: crypto.randomUUID(), name: "New repository" }],
          })
        }
      >
        Add repository
      </Button>
    </div>
  );
}
