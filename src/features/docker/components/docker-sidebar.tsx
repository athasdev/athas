import {
  ArrowClockwiseIcon as Refresh,
  CubeIcon as ContainerIcon,
  HardDrivesIcon as VolumeIcon,
  MagnifyingGlassIcon as Search,
  NetworkIcon as Network,
  PauseIcon as Pause,
  PlayIcon as Play,
  StackIcon as ImageIcon,
  StopIcon as Stop,
  TrashIcon as Trash,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import {
  SidebarEmptyActionState,
  SidebarEmptyState,
  SidebarHeaderIconButton,
  SidebarListItem,
  SidebarSearchFilterRow,
  SidebarSectionHeader,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import {
  getDockerContainerLogs,
  getDockerInventory,
  runDockerContainerAction,
} from "../services/docker-api";
import type {
  DockerContainer,
  DockerContainerAction,
  DockerImage,
  DockerInventory,
  DockerNetwork,
  DockerVolume,
} from "../types/docker.types";

type DockerSection = "containers" | "images" | "volumes" | "networks";

const dockerSections: DockerSection[] = ["containers", "images", "volumes", "networks"];

const emptyInventory: DockerInventory = {
  containers: [],
  images: [],
  volumes: [],
  networks: [],
};

function getContainerStateTone(container: DockerContainer) {
  if (container.health === "unhealthy") return "bg-error/15 text-error";
  if (container.health === "healthy") return "bg-success/15 text-success";
  if (container.state === "running") return "bg-success/15 text-success";
  if (container.state === "exited") return "bg-warning/15 text-warning";
  if (container.state === "paused") return "bg-accent/15 text-accent";
  return "bg-hover text-text-lighter";
}

function includesQuery(values: Array<string | null | undefined>, query: string) {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

function sectionCount(inventory: DockerInventory, section: DockerSection) {
  return inventory[section].length;
}

function ResourceMeta({ children }: { children: React.ReactNode }) {
  return <div className="truncate ui-text-xs text-text-lighter">{children}</div>;
}

function ResourceTitle({ children }: { children: React.ReactNode }) {
  return <div className="truncate ui-text-sm text-text">{children}</div>;
}

function ContainerActions({
  container,
  busy,
  onAction,
}: {
  container: DockerContainer;
  busy: boolean;
  onAction: (container: DockerContainer, action: DockerContainerAction) => void;
}) {
  const isRunning = container.state === "running";
  const isPaused = container.state === "paused";

  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy || isRunning || isPaused}
        tooltip="Start"
        tooltipSide="bottom"
        aria-label={`Start ${container.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(container, "start");
        }}
      >
        <Play className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy || !isRunning}
        tooltip="Stop"
        tooltipSide="bottom"
        aria-label={`Stop ${container.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(container, "stop");
        }}
      >
        <Stop className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy || !isRunning}
        tooltip="Pause"
        tooltipSide="bottom"
        aria-label={`Pause ${container.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(container, "pause");
        }}
      >
        <Pause className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy || isRunning}
        tooltip="Remove"
        tooltipSide="bottom"
        aria-label={`Remove ${container.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(container, "remove");
        }}
      >
        <Trash className="size-3.5" />
      </Button>
    </div>
  );
}

function ContainerRow({
  container,
  busy,
  selected,
  onSelect,
  onAction,
}: {
  container: DockerContainer;
  busy: boolean;
  selected: boolean;
  onSelect: (container: DockerContainer) => void;
  onAction: (container: DockerContainer, action: DockerContainerAction) => void;
}) {
  return (
    <SidebarListItem
      active={selected}
      leading={<ContainerIcon className="size-4 text-text-lighter" weight="duotone" />}
      trailing={<ContainerActions container={container} busy={busy} onAction={onAction} />}
      onClick={() => onSelect(container)}
      contentClassName="overflow-hidden"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <ResourceTitle>{container.name}</ResourceTitle>
          <span
            className={cn(
              "ui-text-xs shrink-0 rounded-full px-1.5 py-0.5 capitalize",
              getContainerStateTone(container),
            )}
          >
            {container.health ?? container.state}
          </span>
        </div>
        <ResourceMeta>
          {container.image}
          {container.ports ? ` · ${container.ports}` : ""}
        </ResourceMeta>
      </div>
    </SidebarListItem>
  );
}

function ImageRow({ image }: { image: DockerImage }) {
  const label = image.repository === "<none>" ? image.id : `${image.repository}:${image.tag}`;
  return (
    <SidebarListItem leading={<ImageIcon className="size-4 text-text-lighter" weight="duotone" />}>
      <ResourceTitle>{label}</ResourceTitle>
      <ResourceMeta>
        {image.size}
        {image.createdSince ? ` · ${image.createdSince}` : ""}
      </ResourceMeta>
    </SidebarListItem>
  );
}

function VolumeRow({ volume }: { volume: DockerVolume }) {
  return (
    <SidebarListItem leading={<VolumeIcon className="size-4 text-text-lighter" weight="duotone" />}>
      <ResourceTitle>{volume.name}</ResourceTitle>
      <ResourceMeta>
        {volume.driver}
        {volume.mountpoint ? ` · ${volume.mountpoint}` : ""}
      </ResourceMeta>
    </SidebarListItem>
  );
}

function NetworkRow({ network }: { network: DockerNetwork }) {
  return (
    <SidebarListItem leading={<Network className="size-4 text-text-lighter" weight="duotone" />}>
      <ResourceTitle>{network.name}</ResourceTitle>
      <ResourceMeta>
        {network.driver}
        {network.scope ? ` · ${network.scope}` : ""}
      </ResourceMeta>
    </SidebarListItem>
  );
}

export function DockerSidebar() {
  const [inventory, setInventory] = useState<DockerInventory>(emptyInventory);
  const [query, setQuery] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<DockerSection>>(
    () => new Set(dockerSections),
  );
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyContainerId, setBusyContainerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInventory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextInventory = await getDockerInventory();
      setInventory(nextInventory);
      setSelectedContainerId((current) => {
        if (current && nextInventory.containers.some((container) => container.id === current)) {
          return current;
        }
        return nextInventory.containers[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setInventory(emptyInventory);
      setSelectedContainerId(null);
      setLogs("");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const selectedContainer = useMemo(
    () => inventory.containers.find((container) => container.id === selectedContainerId) ?? null,
    [inventory.containers, selectedContainerId],
  );

  useEffect(() => {
    if (!selectedContainer) {
      setLogs("");
      return;
    }

    let isCurrent = true;
    void getDockerContainerLogs(selectedContainer.id, 200)
      .then((nextLogs) => {
        if (isCurrent) setLogs(nextLogs);
      })
      .catch((logsError) => {
        if (isCurrent) {
          setLogs(logsError instanceof Error ? logsError.message : String(logsError));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedContainer]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredContainers = inventory.containers.filter((container) =>
    includesQuery(
      [container.name, container.image, container.status, container.state, container.ports],
      normalizedQuery,
    ),
  );
  const filteredImages = inventory.images.filter((image) =>
    includesQuery([image.repository, image.tag, image.id, image.size], normalizedQuery),
  );
  const filteredVolumes = inventory.volumes.filter((volume) =>
    includesQuery([volume.name, volume.driver, volume.mountpoint], normalizedQuery),
  );
  const filteredNetworks = inventory.networks.filter((network) =>
    includesQuery([network.name, network.driver, network.scope], normalizedQuery),
  );

  const toggleSection = (section: DockerSection) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const handleContainerAction = async (
    container: DockerContainer,
    action: DockerContainerAction,
  ) => {
    setBusyContainerId(container.id);
    setError(null);
    try {
      await runDockerContainerAction(container.id, action, action === "remove");
      await loadInventory();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyContainerId(null);
    }
  };

  const renderSection = (section: DockerSection, rows: React.ReactNode, filteredCount: number) => {
    const expanded = expandedSections.has(section);
    return (
      <div key={section} className="min-w-0">
        <SidebarSectionHeader
          expanded={expanded}
          count={
            normalizedQuery ? `${filteredCount}/${sectionCount(inventory, section)}` : filteredCount
          }
          onToggle={() => toggleSection(section)}
          className="capitalize"
        >
          {section}
        </SidebarSectionHeader>
        {expanded ? <div className="space-y-0.5 px-1">{rows}</div> : null}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarSearchFilterRow
        value={query}
        onChange={setQuery}
        searchIcon={Search}
        placeholder="Search Docker"
        actions={
          <SidebarHeaderIconButton
            onClick={() => void loadInventory()}
            disabled={isLoading}
            tooltip="Refresh"
            tooltipSide="bottom"
            aria-label="Refresh Docker resources"
          >
            {isLoading ? <LoadingIndicator compact /> : <Refresh />}
          </SidebarHeaderIconButton>
        }
      />

      {error ? (
        <div className="border-y border-border/60 bg-error/8 px-2 py-1.5 ui-text-xs text-error">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <SidebarEmptyState className="flex-1">Loading Docker resources...</SidebarEmptyState>
      ) : error ? (
        <SidebarEmptyActionState className="flex-1" message="Docker is not available">
          <span className="ui-text-xs text-text-lighter">
            Start Docker Desktop or make sure the Docker CLI can reach the daemon.
          </span>
        </SidebarEmptyActionState>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto py-1">
            {renderSection(
              "containers",
              filteredContainers.length > 0 ? (
                filteredContainers.map((container) => (
                  <ContainerRow
                    key={container.id}
                    container={container}
                    busy={busyContainerId === container.id}
                    selected={selectedContainerId === container.id}
                    onSelect={(nextContainer) => setSelectedContainerId(nextContainer.id)}
                    onAction={handleContainerAction}
                  />
                ))
              ) : (
                <SidebarSectionLabel>No matching containers</SidebarSectionLabel>
              ),
              filteredContainers.length,
            )}
            {renderSection(
              "images",
              filteredImages.length > 0 ? (
                filteredImages.map((image) => (
                  <ImageRow key={`${image.id}-${image.tag}`} image={image} />
                ))
              ) : (
                <SidebarSectionLabel>No matching images</SidebarSectionLabel>
              ),
              filteredImages.length,
            )}
            {renderSection(
              "volumes",
              filteredVolumes.length > 0 ? (
                filteredVolumes.map((volume) => <VolumeRow key={volume.name} volume={volume} />)
              ) : (
                <SidebarSectionLabel>No matching volumes</SidebarSectionLabel>
              ),
              filteredVolumes.length,
            )}
            {renderSection(
              "networks",
              filteredNetworks.length > 0 ? (
                filteredNetworks.map((network) => <NetworkRow key={network.id} network={network} />)
              ) : (
                <SidebarSectionLabel>No matching networks</SidebarSectionLabel>
              ),
              filteredNetworks.length,
            )}
          </div>

          <div className="max-h-44 shrink-0 border-t border-border/70 bg-secondary-bg/35">
            <div className="flex h-7 items-center justify-between px-2">
              <span className="truncate ui-text-xs font-medium text-text">
                {selectedContainer ? `${selectedContainer.name} logs` : "Container logs"}
              </span>
              {selectedContainer ? (
                <Button
                  type="button"
                  variant="ghost"
                  compact
                  className="h-6 px-1.5 ui-text-xs"
                  onClick={() =>
                    void getDockerContainerLogs(selectedContainer.id, 500).then(setLogs)
                  }
                >
                  Refresh
                </Button>
              ) : null}
            </div>
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap px-2 pb-2 font-mono text-[11px] leading-4 text-text-lighter">
              {selectedContainer ? logs || "No logs." : "Select a container to view logs."}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
