import {
  ArrowsClockwiseIcon,
  BugIcon,
  DotsIcon,
  OpenExternalIcon,
  PauseIcon,
  PlayIcon,
  StackIcon,
  StopIcon,
  TerminalWindowIcon,
  TrashIcon,
} from "@/ui/icons";
import { Fragment, type ComponentProps, type ReactNode } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { SidebarListActionRow, SidebarListItem } from "@/ui/sidebar";
import type {
  DockerComposeAction,
  DockerComposeService,
  DockerContainer,
  DockerContainerAction,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from "../types/docker.types";
import { getDockerImageReference, getPublishedDockerTcpUrl } from "../utils/docker-sidebar-utils";

export interface DockerMenuAction {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

export function DockerActionMenu({
  label,
  actions,
}: {
  label: string;
  actions: DockerMenuAction[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" iconOnly tooltip={label} aria-label={label} />
        }
      >
        <DotsIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <Fragment key={action.label}>
            {action.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={action.destructive ? "destructive" : "default"}
              disabled={action.disabled}
              onClick={action.onSelect}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getContainerStateVariant(
  container: DockerContainer,
): ComponentProps<typeof Badge>["variant"] {
  if (container.health === "unhealthy") return "error";
  if (container.health === "healthy") return "success";
  if (container.state === "running") return "success";
  if (container.state === "exited") return "warning";
  if (container.state === "paused") return "accent";
  return "muted";
}

export function DockerResourceRow({
  title,
  description,
  status,
  active = false,
  onClick,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  actions?: ReactNode;
}) {
  const row = (
    <SidebarListItem
      render={onClick ? undefined : <div />}
      type={onClick ? "button" : undefined}
      active={active}
      onClick={onClick}
      description={description}
      trailing={status}
    >
      {title}
    </SidebarListItem>
  );

  return actions ? <SidebarListActionRow actions={actions}>{row}</SidebarListActionRow> : row;
}

function ContainerActions({
  container,
  busy,
  onAction,
  onOpenTerminal,
  onDebug,
  quickUrl,
  onOpenUrl,
}: {
  container: DockerContainer;
  busy: boolean;
  onAction: (container: DockerContainer, action: DockerContainerAction) => void;
  onOpenTerminal: (container: DockerContainer) => void;
  onDebug: (container: DockerContainer) => void;
  quickUrl: string | null;
  onOpenUrl: (url: string) => void;
}) {
  const isRunning = container.state === "running";
  const isPaused = container.state === "paused";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            iconOnly
            tooltip="Container actions"
            aria-label={`Actions for ${container.name}`}
          />
        }
      >
        <DotsIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={busy || isRunning || isPaused}
          onClick={() => onAction(container, "start")}
        >
          <PlayIcon />
          Start
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy || !isRunning} onClick={() => onAction(container, "stop")}>
          <StopIcon />
          Stop
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy || (!isRunning && !isPaused)}
          onClick={() => onAction(container, isPaused ? "unpause" : "pause")}
        >
          {isPaused ? <PlayIcon /> : <PauseIcon />}
          {isPaused ? "Unpause" : "Pause"}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => onAction(container, "restart")}>
          <ArrowsClockwiseIcon />
          Restart
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy || !isRunning} onClick={() => onOpenTerminal(container)}>
          <TerminalWindowIcon />
          Open shell
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy || !isRunning} onClick={() => onDebug(container)}>
          <BugIcon />
          Debug
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy || !quickUrl}
          onClick={() => {
            if (quickUrl) onOpenUrl(quickUrl);
          }}
        >
          <OpenExternalIcon />
          Open service URL
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={busy || isRunning}
          onClick={() => onAction(container, "remove")}
        >
          <TrashIcon />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ContainerRow({
  container,
  busy,
  selected,
  onSelect,
  onAction,
  onOpenTerminal,
  onDebug,
  onOpenUrl,
}: {
  container: DockerContainer;
  busy: boolean;
  selected: boolean;
  onSelect: (container: DockerContainer) => void;
  onAction: (container: DockerContainer, action: DockerContainerAction) => void;
  onOpenTerminal: (container: DockerContainer) => void;
  onDebug: (container: DockerContainer) => void;
  onOpenUrl: (url: string) => void;
}) {
  const quickUrl = getPublishedDockerTcpUrl(container.ports);

  return (
    <DockerResourceRow
      active={selected}
      title={container.name}
      status={
        <Badge variant={getContainerStateVariant(container)}>
          {container.health ?? container.state}
        </Badge>
      }
      description={
        <>
          {container.image}
          {container.ports ? ` · ${container.ports}` : ""}
          {container.size ? ` · ${container.size}` : ""}
        </>
      }
      actions={
        <ContainerActions
          container={container}
          busy={busy}
          onAction={onAction}
          onOpenTerminal={onOpenTerminal}
          onDebug={onDebug}
          quickUrl={quickUrl}
          onOpenUrl={onOpenUrl}
        />
      }
      onClick={() => onSelect(container)}
    />
  );
}

function getComposeServiceVariant(
  service: DockerComposeService,
): ComponentProps<typeof Badge>["variant"] {
  if (service.health === "unhealthy") return "error";
  if (service.health === "healthy") return "success";
  if (service.state === "running") return "success";
  if (service.state === "exited") return "warning";
  return "muted";
}

function ComposeServiceActions({
  service,
  busy,
  onAction,
  quickUrl,
  onOpenUrl,
}: {
  service: DockerComposeService;
  busy: boolean;
  onAction: (service: DockerComposeService, action: DockerComposeAction) => void;
  quickUrl: string | null;
  onOpenUrl: (url: string) => void;
}) {
  const isRunning = service.state === "running";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            iconOnly
            tooltip="Service actions"
            aria-label={`Actions for ${service.name}`}
          />
        }
      >
        <DotsIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={busy} onClick={() => onAction(service, "up")}>
          <PlayIcon />
          Start
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy || !isRunning} onClick={() => onAction(service, "stop")}>
          <StopIcon />
          Stop
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => onAction(service, "restart")}>
          <ArrowsClockwiseIcon />
          Restart
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => onAction(service, "rebuild")}>
          <StackIcon />
          Rebuild
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={busy || !quickUrl}
          onClick={() => {
            if (quickUrl) onOpenUrl(quickUrl);
          }}
        >
          <OpenExternalIcon />
          Open service URL
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ComposeServiceRow({
  service,
  busy,
  onAction,
  onOpenUrl,
}: {
  service: DockerComposeService;
  busy: boolean;
  onAction: (service: DockerComposeService, action: DockerComposeAction) => void;
  onOpenUrl: (url: string) => void;
}) {
  const quickUrl = getPublishedDockerTcpUrl(service.ports);

  return (
    <DockerResourceRow
      title={service.name}
      status={
        <Badge variant={getComposeServiceVariant(service)}>{service.health ?? service.state}</Badge>
      }
      actions={
        <ComposeServiceActions
          service={service}
          busy={busy}
          onAction={onAction}
          quickUrl={quickUrl}
          onOpenUrl={onOpenUrl}
        />
      }
      description={
        <>
          {service.containerName ?? service.status}
          {service.ports ? ` · ${service.ports}` : ""}
        </>
      }
    />
  );
}

export function ImageRow({
  image,
  busy,
  onRun,
  onRemove,
}: {
  image: DockerImage;
  busy: boolean;
  onRun: (image: DockerImage) => void;
  onRemove: (image: DockerImage) => void;
}) {
  const label = getDockerImageReference(image);
  return (
    <DockerResourceRow
      title={label}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                iconOnly
                tooltip="Image actions"
                aria-label={`Actions for ${label}`}
              />
            }
          >
            <DotsIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={busy} onClick={() => onRun(image)}>
              <PlayIcon />
              Run
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => onRemove(image)}>
              <TrashIcon />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      description={
        <>
          {image.size}
          {image.createdSince ? ` · ${image.createdSince}` : ""}
        </>
      }
    />
  );
}

export function VolumeRow({ volume }: { volume: DockerVolume }) {
  return (
    <DockerResourceRow
      title={volume.name}
      description={
        <>
          {volume.driver}
          {volume.mountpoint ? ` · ${volume.mountpoint}` : ""}
        </>
      }
    />
  );
}

export function NetworkRow({ network }: { network: DockerNetwork }) {
  return (
    <DockerResourceRow
      title={network.name}
      description={
        <>
          {network.driver}
          {network.scope ? ` · ${network.scope}` : ""}
        </>
      }
    />
  );
}
