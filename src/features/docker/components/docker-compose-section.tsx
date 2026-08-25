import { ArrowFatLineDownIcon as Down, FileIcon } from "@/ui/icons";
import Badge from "@/ui/badge";
import { EmptyState } from "@/ui/empty";
import type {
  DockerComposeAction,
  DockerComposeProject,
  DockerComposeService,
} from "../types/docker.types";
import { getDockerFileName } from "../utils/docker-sidebar-utils";
import { ComposeServiceRow, DockerActionMenu, DockerResourceRow } from "./docker-resource-rows";
import { DockerCommandOutput } from "./docker-sidebar-states";

interface DockerComposeSectionProps {
  rootFolderPath?: string | null;
  project: DockerComposeProject;
  services: DockerComposeService[];
  envFilePaths: string[];
  output: string | null;
  busyService: string | null;
  onProjectAction: (action: DockerComposeAction, envFiles?: string[]) => void | Promise<void>;
  onSavePreset: () => void | Promise<void>;
  onServiceAction: (
    service: DockerComposeService,
    action: DockerComposeAction,
  ) => void | Promise<void>;
  onOpenUrl: (url: string) => void;
}

export function DockerComposeSection({
  rootFolderPath,
  project,
  services,
  envFilePaths,
  output,
  busyService,
  onProjectAction,
  onSavePreset,
  onServiceAction,
  onOpenUrl,
}: DockerComposeSectionProps) {
  if (!rootFolderPath) {
    return <EmptyState layout="sidebar" message="Open a workspace to inspect Compose services" />;
  }

  if (project.files.length === 0) {
    return <EmptyState layout="sidebar" message="No Compose files in this workspace" />;
  }

  return (
    <>
      <DockerResourceRow
        title="Compose project"
        description={project.files.map(getDockerFileName).join(", ")}
        status={
          <Badge variant="muted" size="compact">
            {project.services.length} services
          </Badge>
        }
        actions={
          <DockerActionMenu
            label="Compose project actions"
            actions={[
              {
                label: "Start with env files",
                icon: <FileIcon />,
                disabled: busyService !== null || envFilePaths.length === 0,
                onSelect: () => void onProjectAction("up", envFilePaths),
              },
              {
                label: "Save preset",
                disabled: busyService !== null,
                onSelect: () => void onSavePreset(),
              },
              {
                label: "Stop project",
                icon: <Down />,
                disabled: busyService !== null,
                separatorBefore: true,
                onSelect: () => void onProjectAction("down"),
              },
            ]}
          />
        }
      />
      <DockerCommandOutput output={output} />
      {services.length > 0 ? (
        services.map((service) => (
          <ComposeServiceRow
            key={service.name}
            service={service}
            busy={busyService === service.name}
            onAction={(nextService, action) => void onServiceAction(nextService, action)}
            onOpenUrl={onOpenUrl}
          />
        ))
      ) : (
        <EmptyState
          layout="sidebar"
          message={
            project.services.length > 0
              ? "No matching Compose services"
              : "No Compose services found"
          }
        />
      )}
    </>
  );
}
