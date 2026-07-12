import {
  ArrowClockwiseIcon as Refresh,
  ArrowFatLineDownIcon as Down,
  ArrowSquareOutIcon as OpenExternal,
  BugIcon as Bug,
  CubeIcon as ContainerIcon,
  DownloadSimpleIcon as Download,
  FileIcon,
  FolderIcon,
  HardDrivesIcon as VolumeIcon,
  MagnifyingGlassIcon as Search,
  NetworkIcon as Network,
  PauseIcon as Pause,
  PlayIcon as Play,
  ArrowsClockwiseIcon as Restart,
  StackIcon as ImageIcon,
  StopIcon as Stop,
  TerminalWindowIcon as Terminal,
  TrashIcon as Trash,
  UploadSimpleIcon as Upload,
} from "@/ui/icons";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";
import { showPromptDialog } from "@/features/dialogs/services/dialog-service";
import {
  SidebarEmptyState,
  SidebarHeaderIconButton,
  SidebarListItem,
  SidebarPanel,
  SidebarSearchFilterRow,
  SidebarSectionLabel,
  SidebarSectionSwitcher,
} from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import {
  buildDockerImage,
  copyFromDockerContainer,
  copyToDockerContainer,
  deleteDockerEnvFile,
  getDockerComposeProject,
  getDockerInventory,
  getDockerProjectConfig,
  loginDockerRegistry,
  listDockerContainerFiles,
  openDockerEnvFile,
  openDockerDevContainer,
  pullDockerRegistryImage,
  pruneDockerResources,
  pushDockerRegistryImage,
  readDockerEnvFile,
  runDockerComposeAction,
  runDockerContainerAction,
  runDockerImage,
  runDockerImageAction,
  saveDockerProjectConfig,
  searchDockerRegistry,
  startDockerContainerLogStream,
  stopDockerContainerLogStream,
  tagDockerImage,
  writeDockerEnvFile,
} from "../services/docker-api";
import type {
  DockerBuildPreset,
  DockerComposeAction,
  DockerComposePreset,
  DockerComposeProject,
  DockerComposeService,
  DockerContainer,
  DockerContainerAction,
  DockerDebugPreset,
  DockerDevContainer,
  DockerEnvFile,
  DockerContainerFileEntry,
  DockerImage,
  DockerPruneTarget,
  DockerInventory,
  DockerLogEvent,
  DockerLogExitEvent,
  DockerNetwork,
  DockerProjectConfig,
  DockerRegistrySearchResult,
  DockerRunPreset,
  DockerVolume,
} from "../types/docker.types";

type DockerSection =
  | "containers"
  | "compose"
  | "project"
  | "images"
  | "registry"
  | "volumes"
  | "networks"
  | "cleanup";
type DockerLogFilter = "all" | "stdout" | "stderr" | "errors";
type DockerLogLine = DockerLogEvent & { id: number };
type DockerDialogMode = "build" | "run" | "env" | null;
type DockerDetailTab = "logs" | "files";
type DockerTab = "resources" | "compose" | "project" | "registry";

const maxLogLines = 1_000;
const dockerTabSections: Record<DockerTab, DockerSection[]> = {
  resources: ["containers", "images", "cleanup", "volumes", "networks"],
  compose: ["compose"],
  project: ["project"],
  registry: ["registry"],
};
const emptyComposeProject: DockerComposeProject = {
  workspacePath: null,
  files: [],
  services: [],
};
const emptyProjectConfig: DockerProjectConfig = {
  workspacePath: null,
  buildPresets: [],
  runPresets: [],
  composePresets: [],
  debugPresets: [],
  workspaceDebugPresets: [],
  envFiles: [],
  devContainers: [],
};

const emptyInventory: DockerInventory = {
  containers: [],
  images: [],
  volumes: [],
  networks: [],
};

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

function includesQuery(values: Array<string | null | undefined>, query: string) {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

function ResourceMeta({ children }: { children: ReactNode }) {
  return <div className="truncate ui-text-sm text-text-lighter">{children}</div>;
}

function ResourceTitle({ children }: { children: ReactNode }) {
  return <div className="truncate ui-text-sm text-text">{children}</div>;
}

function quoteShellArg(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function dockerExecCommand(containerId: string) {
  const shellProbe =
    "if command -v bash >/dev/null 2>&1; then exec bash; " +
    "elif command -v sh >/dev/null 2>&1; then exec sh; " +
    'else echo "No interactive shell found in this container." >&2; exit 127; fi';
  return `docker exec -it ${quoteShellArg(containerId)} sh -lc ${quoteShellArg(shellProbe)}`;
}

function dockerDebugCommand(containerId: string, command: string, workdir?: string | null) {
  const debugCommand = workdir?.trim()
    ? `cd ${quoteShellArg(workdir.trim())} && ${command}`
    : command;
  return `docker exec -it ${quoteShellArg(containerId)} sh -lc ${quoteShellArg(debugCommand)}`;
}

function openDebuggerPane() {
  const state = useUIState.getState();
  state.setBottomPaneActiveTab("debugger");
  state.setIsBottomPaneVisible(true);
}

function isErrorLogLine(line: string) {
  return /\b(error|exception|fatal|panic|failed|unhealthy|crash)\b/i.test(line);
}

function getPublishedTcpUrl(ports: string) {
  const match = ports.match(
    /(?:^|[\s,])(?:0\.0\.0\.0|127\.0\.0\.1|localhost|\[::\]|::)?(?::)?(\d+)->\d+\/tcp/,
  );
  if (!match?.[1]) return null;
  return `http://localhost:${match[1]}`;
}

function splitConfigLines(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getImageReference(image: DockerImage) {
  if (image.repository === "<none>" || image.tag === "<none>") return image.id;
  return `${image.repository}:${image.tag}`;
}

function parentContainerPath(path: string) {
  const normalized = path.trim().replace(/\/+$/, "") || "/";
  if (normalized === "/") return "/";
  const parent = normalized.slice(0, normalized.lastIndexOf("/")) || "/";
  return parent.startsWith("/") ? parent : `/${parent}`;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
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
        disabled={busy || (!isRunning && !isPaused)}
        tooltip={isPaused ? "Unpause" : "Pause"}
        tooltipSide="bottom"
        aria-label={isPaused ? `Unpause ${container.name}` : `Pause ${container.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(container, isPaused ? "unpause" : "pause");
        }}
      >
        {isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy}
        tooltip="Restart"
        tooltipSide="bottom"
        aria-label={`Restart ${container.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(container, "restart");
        }}
      >
        <Restart className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy || !isRunning}
        tooltip="Open shell"
        tooltipSide="bottom"
        aria-label={`Open shell in ${container.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpenTerminal(container);
        }}
      >
        <Terminal className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy || !isRunning}
        tooltip="Debug in container"
        tooltipSide="bottom"
        aria-label={`Debug in ${container.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onDebug(container);
        }}
      >
        <Bug className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy || !quickUrl}
        tooltip="Open service URL"
        tooltipSide="bottom"
        aria-label={`Open service URL for ${container.name}`}
        onClick={(event) => {
          event.stopPropagation();
          if (quickUrl) onOpenUrl(quickUrl);
        }}
      >
        <OpenExternal className="size-3.5" />
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
  const quickUrl = getPublishedTcpUrl(container.ports);

  return (
    <SidebarListItem
      active={selected}
      leading={<ContainerIcon className="size-4 text-text-lighter" weight="duotone" />}
      trailing={
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
      contentClassName="overflow-hidden"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <ResourceTitle>{container.name}</ResourceTitle>
          <Badge
            variant={getContainerStateVariant(container)}
            size="compact"
            className="capitalize"
          >
            {container.health ?? container.state}
          </Badge>
        </div>
        <ResourceMeta>
          {container.image}
          {container.ports ? ` · ${container.ports}` : ""}
          {container.size ? ` · Size ${container.size}` : ""}
        </ResourceMeta>
        {container.healthDetails ? (
          <ResourceMeta>
            Health {container.healthDetails.status || container.health}
            {container.healthDetails.failingStreak > 0
              ? ` · ${container.healthDetails.failingStreak} failures`
              : ""}
            {container.healthDetails.lastExitCode !== null &&
            container.healthDetails.lastExitCode !== undefined
              ? ` · exit ${container.healthDetails.lastExitCode}`
              : ""}
            {container.healthDetails.lastOutput ? ` · ${container.healthDetails.lastOutput}` : ""}
          </ResourceMeta>
        ) : null}
        {container.stats ? (
          <ResourceMeta>
            CPU {container.stats.cpuPercent || "0%"} · Mem {container.stats.memoryUsage || "0B"}
            {container.stats.memoryPercent ? ` (${container.stats.memoryPercent})` : ""} · Net{" "}
            {container.stats.networkIo || "0B / 0B"} · I/O {container.stats.blockIo || "0B / 0B"}
          </ResourceMeta>
        ) : null}
      </div>
    </SidebarListItem>
  );
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
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy}
        tooltip="Start"
        tooltipSide="bottom"
        aria-label={`Start ${service.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(service, "up");
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
        aria-label={`Stop ${service.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(service, "stop");
        }}
      >
        <Stop className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy}
        tooltip="Restart"
        tooltipSide="bottom"
        aria-label={`Restart ${service.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(service, "restart");
        }}
      >
        <Restart className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy}
        tooltip="Rebuild"
        tooltipSide="bottom"
        aria-label={`Rebuild ${service.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(service, "rebuild");
        }}
      >
        <ImageIcon className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        compact
        className="size-6 p-0"
        disabled={busy || !quickUrl}
        tooltip="Open service URL"
        tooltipSide="bottom"
        aria-label={`Open service URL for ${service.name}`}
        onClick={(event) => {
          event.stopPropagation();
          if (quickUrl) onOpenUrl(quickUrl);
        }}
      >
        <OpenExternal className="size-3.5" />
      </Button>
    </div>
  );
}

function ComposeServiceRow({
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
  const quickUrl = getPublishedTcpUrl(service.ports);

  return (
    <SidebarListItem
      leading={<ImageIcon className="size-4 text-text-lighter" weight="duotone" />}
      trailing={
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
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{service.name}</span>
        <Badge variant={getComposeServiceVariant(service)} size="compact" className="capitalize">
          {service.health ?? service.state}
        </Badge>
      </span>
    </SidebarListItem>
  );
}

function ImageRow({
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
  const label = getImageReference(image);
  return (
    <SidebarListItem
      leading={<ImageIcon className="size-4 text-text-lighter" weight="duotone" />}
      trailing={
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            compact
            className="size-6 p-0"
            disabled={busy}
            tooltip="Run image"
            tooltipSide="bottom"
            aria-label={`Run ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              onRun(image);
            }}
          >
            <Play className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            compact
            className="size-6 p-0"
            disabled={busy}
            tooltip="Remove image"
            tooltipSide="bottom"
            aria-label={`Remove ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(image);
            }}
          >
            <Trash className="size-3.5" />
          </Button>
        </div>
      }
      description={
        <>
          {image.size}
          {image.createdSince ? ` · ${image.createdSince}` : ""}
        </>
      }
    >
      {label}
    </SidebarListItem>
  );
}

function VolumeRow({ volume }: { volume: DockerVolume }) {
  return (
    <SidebarListItem
      leading={<VolumeIcon className="size-4 text-text-lighter" weight="duotone" />}
      description={
        <>
          {volume.driver}
          {volume.mountpoint ? ` · ${volume.mountpoint}` : ""}
        </>
      }
    >
      {volume.name}
    </SidebarListItem>
  );
}

function NetworkRow({ network }: { network: DockerNetwork }) {
  return (
    <SidebarListItem
      leading={<Network className="size-4 text-text-lighter" weight="duotone" />}
      description={
        <>
          {network.driver}
          {network.scope ? ` · ${network.scope}` : ""}
        </>
      }
    >
      {network.name}
    </SidebarListItem>
  );
}

export function DockerSidebar() {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const [inventory, setInventory] = useState<DockerInventory>(emptyInventory);
  const [composeProject, setComposeProject] = useState<DockerComposeProject>(emptyComposeProject);
  const [projectConfig, setProjectConfig] = useState<DockerProjectConfig>(emptyProjectConfig);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<DockerTab>("resources");
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<DockerLogLine[]>([]);
  const [logQuery, setLogQuery] = useState("");
  const [logFilter, setLogFilter] = useState<DockerLogFilter>("all");
  const [logStreamId, setLogStreamId] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DockerDetailTab>("logs");
  const [containerPath, setContainerPath] = useState("/");
  const [containerFiles, setContainerFiles] = useState<DockerContainerFileEntry[]>([]);
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isComposeLoading, setIsComposeLoading] = useState(false);
  const [isProjectConfigLoading, setIsProjectConfigLoading] = useState(false);
  const [busyContainerId, setBusyContainerId] = useState<string | null>(null);
  const [busyComposeService, setBusyComposeService] = useState<string | null>(null);
  const [busyDevContainerPath, setBusyDevContainerPath] = useState<string | null>(null);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const [busyPruneTarget, setBusyPruneTarget] = useState<DockerPruneTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [projectConfigError, setProjectConfigError] = useState<string | null>(null);
  const [composeOutput, setComposeOutput] = useState<string | null>(null);
  const [dockerOutput, setDockerOutput] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<DockerDialogMode>(null);
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryResults, setRegistryResults] = useState<DockerRegistrySearchResult[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [registryOutput, setRegistryOutput] = useState<string | null>(null);
  const [isRegistryBusy, setIsRegistryBusy] = useState(false);
  const [buildDraft, setBuildDraft] = useState({
    contextPath: "",
    dockerfilePath: "",
    tag: "",
    buildArgs: "",
  });
  const [runDraft, setRunDraft] = useState({
    image: "",
    name: "",
    ports: "",
    volumes: "",
    env: "",
    envFiles: "",
    command: "",
  });
  const [registryDraft, setRegistryDraft] = useState({
    registry: "",
    username: "",
    password: "",
    image: "",
    target: "",
  });
  const [envDraft, setEnvDraft] = useState({
    path: "",
    relativePath: "",
    content: "",
  });

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
      setLogLines([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const loadComposeProject = useCallback(async () => {
    setIsComposeLoading(true);
    setComposeError(null);
    try {
      const nextProject = await getDockerComposeProject(rootFolderPath);
      setComposeProject(nextProject);
    } catch (loadError) {
      setComposeError(loadError instanceof Error ? loadError.message : String(loadError));
      setComposeProject(emptyComposeProject);
    } finally {
      setIsComposeLoading(false);
    }
  }, [rootFolderPath]);

  useEffect(() => {
    void loadComposeProject();
  }, [loadComposeProject]);

  const loadProjectConfig = useCallback(async () => {
    setIsProjectConfigLoading(true);
    setProjectConfigError(null);
    try {
      const nextConfig = await getDockerProjectConfig(rootFolderPath);
      setProjectConfig(nextConfig);
    } catch (loadError) {
      setProjectConfigError(loadError instanceof Error ? loadError.message : String(loadError));
      setProjectConfig(emptyProjectConfig);
    } finally {
      setIsProjectConfigLoading(false);
    }
  }, [rootFolderPath]);

  useEffect(() => {
    void loadProjectConfig();
  }, [loadProjectConfig]);

  const refreshDocker = useCallback(() => {
    void loadInventory();
    void loadComposeProject();
    void loadProjectConfig();
  }, [loadComposeProject, loadInventory, loadProjectConfig]);

  const selectedContainer = useMemo(
    () => inventory.containers.find((container) => container.id === selectedContainerId) ?? null,
    [inventory.containers, selectedContainerId],
  );

  useEffect(() => {
    setContainerPath("/");
    setContainerFiles([]);
    setFilesError(null);
  }, [selectedContainer?.id]);

  const loadContainerFiles = useCallback(async () => {
    if (!selectedContainer) {
      setContainerFiles([]);
      return;
    }

    setIsFilesLoading(true);
    setFilesError(null);
    try {
      const entries = await listDockerContainerFiles(selectedContainer.id, containerPath);
      setContainerFiles(entries);
    } catch (loadError) {
      setFilesError(loadError instanceof Error ? loadError.message : String(loadError));
      setContainerFiles([]);
    } finally {
      setIsFilesLoading(false);
    }
  }, [containerPath, selectedContainer]);

  useEffect(() => {
    if (!selectedContainer || detailTab !== "files") return;
    void loadContainerFiles();
  }, [detailTab, loadContainerFiles, selectedContainer]);

  useEffect(() => {
    if (!selectedContainer) {
      setLogLines([]);
      setLogError(null);
      return;
    }

    let cancelled = false;
    let activeStreamId: string | null = null;
    let removeLogListener: (() => void) | null = null;
    let removeExitListener: (() => void) | null = null;
    let nextLogId = 0;

    setLogLines([]);
    setLogError(null);
    setLogStreamId(null);

    const startLogStream = async () => {
      try {
        removeLogListener = await listen<DockerLogEvent>("docker-container-log", (event) => {
          const matchesStream = activeStreamId
            ? event.payload.streamId === activeStreamId
            : event.payload.containerId === selectedContainer.id;

          if (cancelled || !matchesStream) return;

          setLogLines((current) =>
            current
              .concat({
                ...event.payload,
                id: nextLogId++,
              })
              .slice(-maxLogLines),
          );
        });
        removeExitListener = await listen<DockerLogExitEvent>(
          "docker-container-log-exit",
          (event) => {
            const matchesStream = activeStreamId
              ? event.payload.streamId === activeStreamId
              : event.payload.containerId === selectedContainer.id;

            if (cancelled || !matchesStream) return;

            setLogStreamId(null);
            if (event.payload.error) {
              setLogError(event.payload.error);
            } else if (event.payload.code && event.payload.code !== 0) {
              setLogError(`Docker log stream exited with code ${event.payload.code}.`);
            }
          },
        );

        const nextStreamId = await startDockerContainerLogStream(selectedContainer.id, 300);
        if (cancelled) {
          void stopDockerContainerLogStream(nextStreamId);
          return;
        }
        activeStreamId = nextStreamId;
        setLogStreamId(nextStreamId);
      } catch (logsError) {
        if (!cancelled) {
          setLogError(logsError instanceof Error ? logsError.message : String(logsError));
        }
      }
    };

    void startLogStream();

    return () => {
      cancelled = true;
      removeLogListener?.();
      removeExitListener?.();
      setLogStreamId(null);
      if (activeStreamId) {
        void stopDockerContainerLogStream(activeStreamId);
      }
    };
  }, [selectedContainer]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredContainers = inventory.containers.filter((container) =>
    includesQuery(
      [
        container.name,
        container.image,
        container.status,
        container.state,
        container.ports,
        container.size,
      ],
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
  const filteredComposeServices = composeProject.services.filter((service) =>
    includesQuery(
      [service.name, service.state, service.status, service.health, service.ports],
      normalizedQuery,
    ),
  );
  const composeEnvFilePaths = projectConfig.envFiles.map((envFile) => envFile.path);
  const projectConfigItemCount =
    projectConfig.envFiles.length +
    projectConfig.devContainers.length +
    projectConfig.buildPresets.length +
    projectConfig.runPresets.length +
    projectConfig.composePresets.length +
    projectConfig.debugPresets.length +
    projectConfig.workspaceDebugPresets.length;
  const normalizedLogQuery = logQuery.trim().toLowerCase();
  const filteredLogLines = logLines.filter((entry) => {
    if (logFilter === "stdout" && entry.stream !== "stdout") return false;
    if (logFilter === "stderr" && entry.stream !== "stderr") return false;
    if (logFilter === "errors" && !isErrorLogLine(entry.line)) return false;
    if (!normalizedLogQuery) return true;
    return entry.line.toLowerCase().includes(normalizedLogQuery);
  });

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

  const handleComposeAction = async (
    service: DockerComposeService | null,
    action: DockerComposeAction,
    envFiles: string[] = [],
  ) => {
    if (!composeProject.workspacePath || composeProject.files.length === 0) return;

    const busyKey = service?.name ?? "__project__";
    setBusyComposeService(busyKey);
    setComposeError(null);
    setComposeOutput(null);
    try {
      const output = await runDockerComposeAction({
        workspacePath: composeProject.workspacePath,
        files: composeProject.files,
        service: service?.name,
        action,
        envFiles,
      });
      const envFileSuffix =
        envFiles.length > 0
          ? ` with ${envFiles.length} env file${envFiles.length === 1 ? "" : "s"}`
          : "";
      setComposeOutput(output.trim() || `Docker Compose ${action} completed${envFileSuffix}.`);
      await loadComposeProject();
      await loadInventory();
    } catch (actionError) {
      setComposeError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyComposeService(null);
    }
  };

  const openBuildDialog = () => {
    const contextPath = rootFolderPath ?? "";
    setBuildDraft({
      contextPath,
      dockerfilePath: contextPath ? `${contextPath.replace(/[\\/]+$/, "")}/Dockerfile` : "",
      tag: "",
      buildArgs: "",
    });
    setDockerOutput(null);
    setDialogMode("build");
  };

  const openRunDialog = (image: DockerImage) => {
    setRunDraft({
      image: getImageReference(image),
      name: "",
      ports: "",
      volumes: "",
      env: "",
      envFiles: "",
      command: "",
    });
    setDockerOutput(null);
    setDialogMode("run");
  };

  const applyBuildPreset = (preset: DockerBuildPreset) => {
    setBuildDraft({
      contextPath: preset.contextPath,
      dockerfilePath: preset.dockerfilePath ?? "",
      tag: preset.tag ?? "",
      buildArgs: preset.buildArgs.join("\n"),
    });
    setDockerOutput(null);
    setDialogMode("build");
  };

  const applyRunPreset = (preset: DockerRunPreset) => {
    setRunDraft({
      image: preset.image,
      name: preset.containerName ?? "",
      ports: preset.ports.join("\n"),
      volumes: preset.volumes.join("\n"),
      env: preset.env.join("\n"),
      envFiles: preset.envFiles.join("\n"),
      command: preset.command ?? "",
    });
    setDockerOutput(null);
    setDialogMode("run");
  };

  const handleBuildImage = async () => {
    const contextPath = buildDraft.contextPath.trim();
    if (!contextPath) return;

    setBusyImageId("__build__");
    setError(null);
    setDockerOutput(null);
    try {
      const output = await buildDockerImage({
        contextPath,
        dockerfilePath: buildDraft.dockerfilePath.trim() || undefined,
        tag: buildDraft.tag.trim() || undefined,
        buildArgs: splitConfigLines(buildDraft.buildArgs),
      });
      setDockerOutput(output.trim() || "Docker image build completed.");
      setDialogMode(null);
      await loadInventory();
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : String(buildError));
    } finally {
      setBusyImageId(null);
    }
  };

  const handleRunImage = async () => {
    const image = runDraft.image.trim();
    if (!image) return;

    setBusyImageId(image);
    setError(null);
    setDockerOutput(null);
    try {
      const output = await runDockerImage({
        image,
        name: runDraft.name.trim() || undefined,
        ports: splitConfigLines(runDraft.ports),
        volumes: splitConfigLines(runDraft.volumes),
        env: splitConfigLines(runDraft.env),
        envFiles: splitConfigLines(runDraft.envFiles),
        command: runDraft.command.trim() || undefined,
        detach: true,
      });
      setDockerOutput(output.trim() || `Started ${image}.`);
      setDialogMode(null);
      await loadInventory();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setBusyImageId(null);
    }
  };

  const saveProjectConfig = async (nextConfig: DockerProjectConfig) => {
    if (!rootFolderPath) return;
    setProjectConfigError(null);
    const savedConfig = await saveDockerProjectConfig(rootFolderPath, nextConfig);
    setProjectConfig(savedConfig);
  };

  const handleSaveBuildPreset = async () => {
    if (!rootFolderPath || !buildDraft.contextPath.trim()) return;
    const name = await showPromptDialog("Build preset name", {
      title: "Save Build Preset",
      placeholder: "production image",
      confirmLabel: "Save",
    });
    const presetName = name?.trim();
    if (!presetName) return;

    try {
      await saveProjectConfig({
        ...projectConfig,
        buildPresets: projectConfig.buildPresets
          .filter((preset) => preset.name !== presetName)
          .concat({
            name: presetName,
            contextPath: buildDraft.contextPath.trim(),
            dockerfilePath: buildDraft.dockerfilePath.trim() || null,
            tag: buildDraft.tag.trim() || null,
            buildArgs: splitConfigLines(buildDraft.buildArgs),
          }),
      });
    } catch (saveError) {
      setProjectConfigError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const handleSaveRunPreset = async () => {
    if (!rootFolderPath || !runDraft.image.trim()) return;
    const name = await showPromptDialog("Run preset name", {
      title: "Save Run Preset",
      placeholder: "web app",
      confirmLabel: "Save",
    });
    const presetName = name?.trim();
    if (!presetName) return;

    try {
      await saveProjectConfig({
        ...projectConfig,
        runPresets: projectConfig.runPresets
          .filter((preset) => preset.name !== presetName)
          .concat({
            name: presetName,
            image: runDraft.image.trim(),
            containerName: runDraft.name.trim() || null,
            ports: splitConfigLines(runDraft.ports),
            volumes: splitConfigLines(runDraft.volumes),
            env: splitConfigLines(runDraft.env),
            envFiles: splitConfigLines(runDraft.envFiles),
            command: runDraft.command.trim() || null,
          }),
      });
    } catch (saveError) {
      setProjectConfigError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const handleSaveComposePreset = async () => {
    if (!rootFolderPath || composeProject.files.length === 0) return;
    const name = await showPromptDialog("Compose preset name", {
      title: "Save Compose Preset",
      placeholder: "start workspace",
      confirmLabel: "Save",
    });
    const presetName = name?.trim();
    if (!presetName) return;

    try {
      await saveProjectConfig({
        ...projectConfig,
        composePresets: projectConfig.composePresets
          .filter((preset) => preset.name !== presetName)
          .concat({
            name: presetName,
            files: composeProject.files,
            service: null,
            action: "up",
            envFiles: projectConfig.envFiles.map((envFile) => envFile.path),
          }),
      });
    } catch (saveError) {
      setProjectConfigError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const handleRunComposePreset = async (preset: DockerComposePreset) => {
    if (!composeProject.workspacePath) return;

    const busyKey = `preset:${preset.name}`;
    setBusyComposeService(busyKey);
    setComposeError(null);
    setComposeOutput(null);
    try {
      const output = await runDockerComposeAction({
        workspacePath: composeProject.workspacePath,
        files: preset.files.length > 0 ? preset.files : composeProject.files,
        service: preset.service ?? undefined,
        action: preset.action,
        envFiles: preset.envFiles,
      });
      setComposeOutput(output.trim() || `Docker Compose preset ${preset.name} completed.`);
      await loadComposeProject();
      await loadInventory();
    } catch (actionError) {
      setComposeError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyComposeService(null);
    }
  };

  const openEnvFile = async (envFile: DockerEnvFile) => {
    if (!rootFolderPath) return;

    setProjectConfigError(null);
    try {
      const content = await readDockerEnvFile(rootFolderPath, envFile.path);
      setEnvDraft({
        path: envFile.path,
        relativePath: envFile.relativePath,
        content,
      });
      setDialogMode("env");
    } catch (readError) {
      setProjectConfigError(readError instanceof Error ? readError.message : String(readError));
    }
  };

  const handleOpenEnvFile = async () => {
    if (!rootFolderPath) return;

    const path = await showPromptDialog("Env file path", {
      title: "Open Env File",
      placeholder: ".env",
      confirmLabel: "Open",
      defaultValue: ".env",
    });
    const envPath = path?.trim();
    if (!envPath) return;

    setProjectConfigError(null);
    try {
      const { file, content } = await openDockerEnvFile(rootFolderPath, envPath);
      setEnvDraft({
        path: file.path,
        relativePath: file.relativePath,
        content,
      });
      await loadProjectConfig();
      setDialogMode("env");
    } catch (openError) {
      setProjectConfigError(openError instanceof Error ? openError.message : String(openError));
    }
  };

  const handleSaveEnvFile = async () => {
    if (!rootFolderPath || !envDraft.path) return;

    setProjectConfigError(null);
    try {
      await writeDockerEnvFile(rootFolderPath, envDraft.path, envDraft.content);
      setDialogMode(null);
      await loadProjectConfig();
    } catch (writeError) {
      setProjectConfigError(writeError instanceof Error ? writeError.message : String(writeError));
    }
  };

  const handleDeleteEnvFile = async (envFile: DockerEnvFile) => {
    if (!rootFolderPath) return;

    const confirmation = await showPromptDialog(`Type delete to remove ${envFile.relativePath}`, {
      title: "Delete Env File",
      placeholder: "delete",
      confirmLabel: "Delete",
    });
    if (confirmation?.trim().toLowerCase() !== "delete") return;

    setProjectConfigError(null);
    try {
      await deleteDockerEnvFile(rootFolderPath, envFile.path);
      await loadProjectConfig();
    } catch (deleteError) {
      setProjectConfigError(
        deleteError instanceof Error ? deleteError.message : String(deleteError),
      );
    }
  };

  const handleOpenDevContainer = async (devContainer: DockerDevContainer) => {
    if (!rootFolderPath || devContainer.kind === "unsupported") return;

    setBusyDevContainerPath(devContainer.configPath);
    setProjectConfigError(null);
    setDockerOutput(null);
    try {
      const result = await openDockerDevContainer(rootFolderPath, devContainer.configPath);
      window.dispatchEvent(
        new CustomEvent("create-terminal-with-command", {
          detail: {
            command: result.command,
            name: result.name,
          },
        }),
      );
      setDockerOutput(result.output.trim() || `Opened ${devContainer.name}.`);
      await loadInventory();
      await loadComposeProject();
    } catch (openError) {
      setProjectConfigError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setBusyDevContainerPath(null);
    }
  };

  const handleImageRemove = async (image: DockerImage) => {
    setBusyImageId(image.id);
    setError(null);
    setDockerOutput(null);
    try {
      const output = await runDockerImageAction(image.id, "remove", false);
      setDockerOutput(output.trim() || `Removed ${getImageReference(image)}.`);
      await loadInventory();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setBusyImageId(null);
    }
  };

  const handlePrune = async (target: DockerPruneTarget, includeVolumes = false) => {
    const label = includeVolumes ? `${target} and volumes` : target;
    const confirmation = await showPromptDialog(`Type prune to clean up Docker ${label}`, {
      title: "Confirm Docker Cleanup",
      placeholder: "prune",
      confirmLabel: "Prune",
    });
    if (confirmation?.trim().toLowerCase() !== "prune") return;

    setBusyPruneTarget(target);
    setError(null);
    setDockerOutput(null);
    try {
      const output = await pruneDockerResources(target, includeVolumes);
      setDockerOutput(output.trim() || `Docker ${target} cleanup completed.`);
      await loadInventory();
      await loadComposeProject();
    } catch (pruneError) {
      setError(pruneError instanceof Error ? pruneError.message : String(pruneError));
    } finally {
      setBusyPruneTarget(null);
    }
  };

  const openContainerTerminal = (container: DockerContainer) => {
    window.dispatchEvent(
      new CustomEvent("create-terminal-with-command", {
        detail: {
          command: dockerExecCommand(container.id),
          name: `Docker: ${container.name}`,
        },
      }),
    );
  };

  const startDockerDebugSession = ({
    containerId,
    containerName,
    command,
    workdir,
    configId,
  }: {
    containerId: string;
    containerName: string;
    command: string;
    workdir?: string | null;
    configId: string;
  }) => {
    const debugCommand = dockerDebugCommand(containerId, command, workdir);
    window.dispatchEvent(
      new CustomEvent("create-terminal-with-command", {
        detail: {
          command: debugCommand,
          name: `Debug: ${containerName}`,
        },
      }),
    );
    useDebuggerStore.getState().actions.startSession({
      id: `docker_debug_${Date.now()}`,
      name: `Debug: ${containerName}`,
      configId,
      command: debugCommand,
      startedAt: Date.now(),
      status: "running",
    });
    openDebuggerPane();
  };

  const handleDebugContainer = async (container: DockerContainer) => {
    const command = await showPromptDialog("Debug command", {
      title: "Debug In Container",
      placeholder: "python -m pdb app.py",
      confirmLabel: "Debug",
    });
    if (!command?.trim()) return;

    const workdir = await showPromptDialog("Working directory", {
      title: "Debug In Container",
      placeholder: "/workspace",
      confirmLabel: "Start",
    });

    startDockerDebugSession({
      containerId: container.id,
      containerName: container.name,
      command: command.trim(),
      workdir: workdir?.trim() || null,
      configId: `docker-container-${container.id}`,
    });
  };

  const handleSaveDebugPreset = async () => {
    if (!rootFolderPath) return;
    const name = await showPromptDialog("Debug preset name", {
      title: "Save Debug Preset",
      placeholder: "debug server",
      confirmLabel: "Next",
    });
    const presetName = name?.trim();
    if (!presetName) return;

    const command = await showPromptDialog("Debug command", {
      title: "Save Debug Preset",
      placeholder: "python -m pdb app.py",
      confirmLabel: "Next",
    });
    if (!command?.trim()) return;

    const workdir = await showPromptDialog("Working directory", {
      title: "Save Debug Preset",
      placeholder: "/workspace",
      confirmLabel: "Save",
    });

    try {
      await saveProjectConfig({
        ...projectConfig,
        debugPresets: projectConfig.debugPresets
          .filter((preset) => preset.name !== presetName)
          .concat({
            name: presetName,
            command: command.trim(),
            workdir: workdir?.trim() || null,
            target: "container",
            source: "project",
          }),
      });
    } catch (saveError) {
      setProjectConfigError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const handleRunDebugPreset = (preset: DockerDebugPreset) => {
    if (!selectedContainer) {
      setProjectConfigError("Select a running container before starting a Docker debug preset.");
      return;
    }
    if (selectedContainer.state !== "running") {
      setProjectConfigError("Docker debug presets require a running container.");
      return;
    }

    setProjectConfigError(null);
    startDockerDebugSession({
      containerId: selectedContainer.id,
      containerName: selectedContainer.name,
      command: preset.command,
      workdir: preset.workdir,
      configId: `docker-debug-preset-${preset.name}`,
    });
  };

  const handleDeletePreset = async (
    kind: "build" | "run" | "compose" | "debug",
    presetName: string,
  ) => {
    if (!rootFolderPath) return;

    try {
      await saveProjectConfig({
        ...projectConfig,
        buildPresets:
          kind === "build"
            ? projectConfig.buildPresets.filter((preset) => preset.name !== presetName)
            : projectConfig.buildPresets,
        runPresets:
          kind === "run"
            ? projectConfig.runPresets.filter((preset) => preset.name !== presetName)
            : projectConfig.runPresets,
        composePresets:
          kind === "compose"
            ? projectConfig.composePresets.filter((preset) => preset.name !== presetName)
            : projectConfig.composePresets,
        debugPresets:
          kind === "debug"
            ? projectConfig.debugPresets.filter((preset) => preset.name !== presetName)
            : projectConfig.debugPresets,
      });
    } catch (deleteError) {
      setProjectConfigError(
        deleteError instanceof Error ? deleteError.message : String(deleteError),
      );
    }
  };

  const openServiceUrl = (url: string) => {
    void openUrl(url);
  };

  const handleCopyFromContainer = async (entry: DockerContainerFileEntry) => {
    if (!selectedContainer) return;
    const hostPath = await showPromptDialog("Copy to host path", {
      title: "Copy From Container",
      placeholder: "/host/path",
      confirmLabel: "Copy",
    });
    if (!hostPath?.trim()) return;

    setFilesError(null);
    setDockerOutput(null);
    try {
      const output = await copyFromDockerContainer({
        containerId: selectedContainer.id,
        containerPath: entry.path,
        hostPath: hostPath.trim(),
      });
      setDockerOutput(output.trim() || `Copied ${entry.path} to ${hostPath.trim()}.`);
    } catch (copyError) {
      setFilesError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  };

  const handleCopyToContainer = async () => {
    if (!selectedContainer) return;
    const hostPath = await showPromptDialog("Host file or folder path", {
      title: "Copy To Container",
      placeholder: "/host/path",
      confirmLabel: "Next",
    });
    if (!hostPath?.trim()) return;

    const containerDestination = await showPromptDialog("Container destination path", {
      title: "Copy To Container",
      defaultValue: containerPath,
      placeholder: "/container/path",
      confirmLabel: "Copy",
    });
    if (!containerDestination?.trim()) return;

    setFilesError(null);
    setDockerOutput(null);
    try {
      const output = await copyToDockerContainer({
        containerId: selectedContainer.id,
        hostPath: hostPath.trim(),
        containerPath: containerDestination.trim(),
      });
      setDockerOutput(
        output.trim() || `Copied ${hostPath.trim()} to ${containerDestination.trim()}.`,
      );
      await loadContainerFiles();
    } catch (copyError) {
      setFilesError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  };

  const handleRegistrySearch = async () => {
    const query = registryQuery.trim();
    if (!query) return;

    setIsRegistryBusy(true);
    setRegistryError(null);
    try {
      const results = await searchDockerRegistry(query, 25);
      setRegistryResults(results);
    } catch (searchError) {
      setRegistryError(searchError instanceof Error ? searchError.message : String(searchError));
      setRegistryResults([]);
    } finally {
      setIsRegistryBusy(false);
    }
  };

  const handleRegistryLogin = async () => {
    if (!registryDraft.username.trim() || !registryDraft.password) return;

    setIsRegistryBusy(true);
    setRegistryError(null);
    setRegistryOutput(null);
    try {
      const output = await loginDockerRegistry({
        registry: registryDraft.registry.trim() || undefined,
        username: registryDraft.username.trim(),
        password: registryDraft.password,
      });
      setRegistryOutput(output.trim() || "Docker registry login completed.");
      setRegistryDraft((current) => ({ ...current, password: "" }));
    } catch (loginError) {
      setRegistryError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setIsRegistryBusy(false);
    }
  };

  const handleRegistryPull = async (image: string) => {
    const imageName = image.trim();
    if (!imageName) return;

    setIsRegistryBusy(true);
    setRegistryError(null);
    setRegistryOutput(null);
    try {
      const output = await pullDockerRegistryImage(imageName);
      setRegistryOutput(output.trim() || `Pulled ${imageName}.`);
      await loadInventory();
    } catch (pullError) {
      setRegistryError(pullError instanceof Error ? pullError.message : String(pullError));
    } finally {
      setIsRegistryBusy(false);
    }
  };

  const handleRegistryPush = async () => {
    const imageName = registryDraft.image.trim();
    if (!imageName) return;

    setIsRegistryBusy(true);
    setRegistryError(null);
    setRegistryOutput(null);
    try {
      const output = await pushDockerRegistryImage(imageName);
      setRegistryOutput(output.trim() || `Pushed ${imageName}.`);
    } catch (pushError) {
      setRegistryError(pushError instanceof Error ? pushError.message : String(pushError));
    } finally {
      setIsRegistryBusy(false);
    }
  };

  const handleTagImage = async () => {
    const source = registryDraft.image.trim();
    const target = registryDraft.target.trim();
    if (!source || !target) return;

    setIsRegistryBusy(true);
    setRegistryError(null);
    setRegistryOutput(null);
    try {
      const output = await tagDockerImage(source, target);
      setRegistryOutput(output.trim() || `Tagged ${source} as ${target}.`);
      await loadInventory();
    } catch (tagError) {
      setRegistryError(tagError instanceof Error ? tagError.message : String(tagError));
    } finally {
      setIsRegistryBusy(false);
    }
  };

  const sectionTabs = useMemo(
    (): Array<{ id: DockerTab; label: string; icon: ReactNode }> => [
      {
        id: "resources",
        label: "Resources",
        icon: <ContainerIcon size={16} weight="duotone" />,
      },
      { id: "compose", label: "Compose", icon: <Restart size={16} /> },
      { id: "project", label: "Project", icon: <FolderIcon size={16} weight="duotone" /> },
      { id: "registry", label: "Registry", icon: <Upload size={16} /> },
    ],
    [],
  );

  const renderSection = (section: DockerSection, rows: ReactNode, _filteredCount?: number) => {
    const title = section === "cleanup" ? "Cleanup" : section[0].toUpperCase() + section.slice(1);
    const isVisible = dockerTabSections[activeTab].includes(section);

    return (
      <div key={section} className={cn("min-w-0", !isVisible && "hidden")}>
        <SidebarSectionLabel className="px-1 ui-text-sm font-medium text-text">
          {title}
        </SidebarSectionLabel>
        <div className="space-y-0.5">{rows}</div>
      </div>
    );
  };

  return (
    <>
      <SidebarPanel className="ui-font select-none gap-2 p-2">
        <SidebarSectionSwitcher
          items={sectionTabs}
          value={activeTab}
          onChange={(tab) => setActiveTab(tab as DockerTab)}
        />

        <SidebarSearchFilterRow
          value={query}
          onChange={setQuery}
          searchIcon={Search}
          placeholder="Search Docker"
          actions={
            <SidebarHeaderIconButton
              onClick={refreshDocker}
              disabled={isLoading || isComposeLoading || isProjectConfigLoading}
              tooltip="Refresh"
              tooltipSide="bottom"
              aria-label="Refresh Docker resources"
            >
              {isLoading || isComposeLoading || isProjectConfigLoading ? (
                <LoadingIndicator compact />
              ) : (
                <Refresh />
              )}
            </SidebarHeaderIconButton>
          }
        />

        {error ? (
          <div className="border-y border-border/60 bg-error/8 px-2 py-1.5 ui-text-sm text-error">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <SidebarEmptyState className="flex-1">Loading Docker resources...</SidebarEmptyState>
        ) : (
          <>
            <div className="scrollbar-hidden min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto p-1">
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
                      onOpenTerminal={openContainerTerminal}
                      onDebug={(nextContainer) => void handleDebugContainer(nextContainer)}
                      onOpenUrl={openServiceUrl}
                    />
                  ))
                ) : (
                  <SidebarSectionLabel>No matching containers</SidebarSectionLabel>
                ),
                filteredContainers.length,
              )}
              {renderSection(
                "compose",
                composeError ? (
                  <SidebarSectionLabel>{composeError}</SidebarSectionLabel>
                ) : !rootFolderPath ? (
                  <SidebarSectionLabel>
                    Open a workspace to inspect Compose services
                  </SidebarSectionLabel>
                ) : composeProject.files.length === 0 ? (
                  <SidebarSectionLabel>No Compose files in this workspace</SidebarSectionLabel>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 px-2 py-1">
                      <div className="min-w-0 truncate ui-text-sm text-text-lighter">
                        {composeProject.files.map(fileName).join(", ")}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          compact
                          className="h-6 px-1.5 ui-text-sm"
                          disabled={busyComposeService !== null || composeEnvFilePaths.length === 0}
                          tooltip={
                            composeEnvFilePaths.length === 0
                              ? "Add a project env file first"
                              : "Start Compose with project env files"
                          }
                          tooltipSide="bottom"
                          onClick={() => void handleComposeAction(null, "up", composeEnvFilePaths)}
                        >
                          <FileIcon className="size-3.5" />
                          Env Up
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          compact
                          className="h-6 px-1.5 ui-text-sm"
                          disabled={busyComposeService !== null}
                          onClick={() => void handleSaveComposePreset()}
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          compact
                          className="h-6 px-1.5 ui-text-sm"
                          disabled={busyComposeService !== null}
                          onClick={() => void handleComposeAction(null, "down")}
                        >
                          <Down className="size-3.5" />
                          Down
                        </Button>
                      </div>
                    </div>
                    {composeOutput ? (
                      <div className="mx-2 mb-1 max-h-16 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-primary-bg px-2 py-1 font-mono text-[11px] text-text-lighter">
                        {composeOutput}
                      </div>
                    ) : null}
                    {filteredComposeServices.length > 0 ? (
                      filteredComposeServices.map((service) => (
                        <ComposeServiceRow
                          key={service.name}
                          service={service}
                          busy={busyComposeService === service.name}
                          onAction={(nextService, action) =>
                            void handleComposeAction(nextService, action)
                          }
                          onOpenUrl={openServiceUrl}
                        />
                      ))
                    ) : (
                      <SidebarSectionLabel>
                        {composeProject.services.length > 0
                          ? "No matching Compose services"
                          : "No Compose services found"}
                      </SidebarSectionLabel>
                    )}
                  </>
                ),
                filteredComposeServices.length,
              )}
              {renderSection(
                "project",
                !rootFolderPath ? (
                  <SidebarSectionLabel>
                    Open a workspace to manage Docker presets
                  </SidebarSectionLabel>
                ) : isProjectConfigLoading ? (
                  <SidebarSectionLabel>Loading project Docker config...</SidebarSectionLabel>
                ) : projectConfigError ? (
                  <SidebarSectionLabel>{projectConfigError}</SidebarSectionLabel>
                ) : projectConfigItemCount === 0 ? (
                  <div className="space-y-1 px-2 py-1">
                    <SidebarSectionLabel>
                      No env files or presets in this workspace
                    </SidebarSectionLabel>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        compact
                        className="h-6 px-1.5 ui-text-sm"
                        onClick={() => void handleOpenEnvFile()}
                      >
                        <FileIcon className="size-3.5" />
                        Env
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        compact
                        className="h-6 px-1.5 ui-text-sm"
                        onClick={() => void handleSaveDebugPreset()}
                      >
                        <Bug className="size-3.5" />
                        Save Debug
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 px-2 py-1">
                      <div className="min-w-0 truncate ui-text-sm text-text-lighter">
                        Project Docker settings
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          compact
                          className="h-6 px-1.5 ui-text-sm"
                          onClick={() => void handleOpenEnvFile()}
                        >
                          <FileIcon className="size-3.5" />
                          Env
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          compact
                          className="h-6 px-1.5 ui-text-sm"
                          onClick={() => void handleSaveDebugPreset()}
                        >
                          <Bug className="size-3.5" />
                          Save Debug
                        </Button>
                      </div>
                    </div>
                    {projectConfig.devContainers.length > 0 ? (
                      <div className="space-y-0.5">
                        <SidebarSectionLabel>Dev Containers</SidebarSectionLabel>
                        {projectConfig.devContainers.map((devContainer) => (
                          <SidebarListItem
                            key={devContainer.configPath}
                            leading={
                              <ContainerIcon
                                className="size-4 text-text-lighter"
                                weight="duotone"
                              />
                            }
                            trailing={
                              <Button
                                type="button"
                                variant="ghost"
                                compact
                                className="h-6 px-1.5 ui-text-sm"
                                disabled={
                                  busyDevContainerPath !== null ||
                                  devContainer.kind === "unsupported"
                                }
                                onClick={() => void handleOpenDevContainer(devContainer)}
                              >
                                {busyDevContainerPath === devContainer.configPath ? (
                                  <LoadingIndicator compact />
                                ) : (
                                  "Open"
                                )}
                              </Button>
                            }
                          >
                            <ResourceTitle>{devContainer.name}</ResourceTitle>
                            <ResourceMeta>
                              {devContainer.kind}
                              {devContainer.service ? ` · ${devContainer.service}` : ""}
                              {devContainer.image ? ` · ${devContainer.image}` : ""}
                              {devContainer.forwardPorts.length > 0
                                ? ` · ports ${devContainer.forwardPorts.join(", ")}`
                                : ""}
                            </ResourceMeta>
                            {devContainer.containerEnv.length > 0 ||
                            devContainer.workspaceMount ||
                            devContainer.mounts.length > 0 ||
                            devContainer.onCreateCommand ||
                            devContainer.postCreateCommand ||
                            devContainer.postStartCommand ||
                            devContainer.postAttachCommand ? (
                              <ResourceMeta>
                                {[
                                  devContainer.containerEnv.length > 0
                                    ? `${devContainer.containerEnv.length} env`
                                    : null,
                                  devContainer.mounts.length > 0
                                    ? `${devContainer.mounts.length} mounts`
                                    : null,
                                  devContainer.workspaceMount ? "workspaceMount" : null,
                                  devContainer.onCreateCommand ? "onCreate" : null,
                                  devContainer.postCreateCommand ? "postCreate" : null,
                                  devContainer.postStartCommand ? "postStart" : null,
                                  devContainer.postAttachCommand ? "postAttach" : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </ResourceMeta>
                            ) : null}
                            <ResourceMeta>{devContainer.relativePath}</ResourceMeta>
                          </SidebarListItem>
                        ))}
                      </div>
                    ) : null}
                    {projectConfig.workspaceDebugPresets.length > 0 ? (
                      <div className="space-y-0.5">
                        <SidebarSectionLabel>Launch configs</SidebarSectionLabel>
                        {projectConfig.workspaceDebugPresets.map((preset) => (
                          <SidebarListItem
                            key={`${preset.source}-${preset.name}`}
                            leading={<Bug className="size-4 text-text-lighter" weight="duotone" />}
                            trailing={
                              <Button
                                type="button"
                                variant="ghost"
                                compact
                                className="h-6 px-1.5 ui-text-sm"
                                onClick={() => handleRunDebugPreset(preset)}
                              >
                                Run
                              </Button>
                            }
                          >
                            <ResourceTitle>{preset.name}</ResourceTitle>
                            <ResourceMeta>
                              {preset.command}
                              {preset.workdir ? ` · ${preset.workdir}` : ""}
                            </ResourceMeta>
                          </SidebarListItem>
                        ))}
                      </div>
                    ) : null}
                    {projectConfig.debugPresets.length > 0 ? (
                      <div className="space-y-0.5">
                        <SidebarSectionLabel>Debug presets</SidebarSectionLabel>
                        {projectConfig.debugPresets.map((preset) => (
                          <SidebarListItem
                            key={preset.name}
                            leading={<Bug className="size-4 text-text-lighter" weight="duotone" />}
                            trailing={
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  compact
                                  className="h-6 px-1.5 ui-text-sm"
                                  onClick={() => handleRunDebugPreset(preset)}
                                >
                                  Run
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  compact
                                  className="size-6 p-0"
                                  tooltip="Delete preset"
                                  tooltipSide="left"
                                  aria-label={`Delete ${preset.name}`}
                                  onClick={() => void handleDeletePreset("debug", preset.name)}
                                >
                                  <Trash className="size-3.5" />
                                </Button>
                              </div>
                            }
                          >
                            <ResourceTitle>{preset.name}</ResourceTitle>
                            <ResourceMeta>
                              {preset.command}
                              {preset.workdir ? ` · ${preset.workdir}` : ""}
                            </ResourceMeta>
                          </SidebarListItem>
                        ))}
                      </div>
                    ) : null}
                    {projectConfig.envFiles.length > 0 ? (
                      <div className="space-y-0.5">
                        <SidebarSectionLabel>Env files</SidebarSectionLabel>
                        {projectConfig.envFiles.map((envFile) => (
                          <SidebarListItem
                            key={envFile.path}
                            leading={
                              <FileIcon className="size-4 text-text-lighter" weight="duotone" />
                            }
                            trailing={
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  compact
                                  className="h-6 px-1.5 ui-text-sm"
                                  onClick={() => void openEnvFile(envFile)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  compact
                                  className="size-6 p-0"
                                  tooltip="Delete env file"
                                  tooltipSide="left"
                                  aria-label={`Delete ${envFile.relativePath}`}
                                  onClick={() => void handleDeleteEnvFile(envFile)}
                                >
                                  <Trash className="size-3.5" />
                                </Button>
                              </div>
                            }
                          >
                            <ResourceTitle>{envFile.relativePath}</ResourceTitle>
                            <ResourceMeta>
                              {envFile.variableCount} variables
                              {envFile.keys.length > 0
                                ? ` · ${envFile.keys.slice(0, 3).join(", ")}`
                                : ""}
                            </ResourceMeta>
                          </SidebarListItem>
                        ))}
                      </div>
                    ) : null}
                    {projectConfig.buildPresets.length > 0 ? (
                      <div className="space-y-0.5">
                        <SidebarSectionLabel>Build presets</SidebarSectionLabel>
                        {projectConfig.buildPresets.map((preset) => (
                          <SidebarListItem
                            key={preset.name}
                            leading={
                              <ImageIcon className="size-4 text-text-lighter" weight="duotone" />
                            }
                            trailing={
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  compact
                                  className="h-6 px-1.5 ui-text-sm"
                                  onClick={() => applyBuildPreset(preset)}
                                >
                                  Use
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  compact
                                  className="size-6 p-0"
                                  tooltip="Delete preset"
                                  tooltipSide="left"
                                  aria-label={`Delete ${preset.name}`}
                                  onClick={() => void handleDeletePreset("build", preset.name)}
                                >
                                  <Trash className="size-3.5" />
                                </Button>
                              </div>
                            }
                          >
                            <ResourceTitle>{preset.name}</ResourceTitle>
                            <ResourceMeta>{preset.tag || preset.contextPath}</ResourceMeta>
                          </SidebarListItem>
                        ))}
                      </div>
                    ) : null}
                    {projectConfig.runPresets.length > 0 ? (
                      <div className="space-y-0.5">
                        <SidebarSectionLabel>Run presets</SidebarSectionLabel>
                        {projectConfig.runPresets.map((preset) => (
                          <SidebarListItem
                            key={preset.name}
                            leading={
                              <ContainerIcon
                                className="size-4 text-text-lighter"
                                weight="duotone"
                              />
                            }
                            trailing={
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  compact
                                  className="h-6 px-1.5 ui-text-sm"
                                  onClick={() => applyRunPreset(preset)}
                                >
                                  Use
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  compact
                                  className="size-6 p-0"
                                  tooltip="Delete preset"
                                  tooltipSide="left"
                                  aria-label={`Delete ${preset.name}`}
                                  onClick={() => void handleDeletePreset("run", preset.name)}
                                >
                                  <Trash className="size-3.5" />
                                </Button>
                              </div>
                            }
                          >
                            <ResourceTitle>{preset.name}</ResourceTitle>
                            <ResourceMeta>
                              {preset.image}
                              {preset.envFiles.length > 0 ? " · env file" : ""}
                            </ResourceMeta>
                          </SidebarListItem>
                        ))}
                      </div>
                    ) : null}
                    {projectConfig.composePresets.length > 0 ? (
                      <div className="space-y-0.5">
                        <SidebarSectionLabel>Compose presets</SidebarSectionLabel>
                        {projectConfig.composePresets.map((preset) => (
                          <SidebarListItem
                            key={preset.name}
                            leading={
                              <Restart className="size-4 text-text-lighter" weight="duotone" />
                            }
                            trailing={
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  compact
                                  className="h-6 px-1.5 ui-text-sm"
                                  disabled={busyComposeService !== null}
                                  onClick={() => void handleRunComposePreset(preset)}
                                >
                                  {busyComposeService === `preset:${preset.name}` ? (
                                    <LoadingIndicator compact />
                                  ) : (
                                    "Run"
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  compact
                                  className="size-6 p-0"
                                  tooltip="Delete preset"
                                  tooltipSide="left"
                                  aria-label={`Delete ${preset.name}`}
                                  onClick={() => void handleDeletePreset("compose", preset.name)}
                                >
                                  <Trash className="size-3.5" />
                                </Button>
                              </div>
                            }
                          >
                            <ResourceTitle>{preset.name}</ResourceTitle>
                            <ResourceMeta>
                              {preset.action}
                              {preset.service ? ` · ${preset.service}` : ""}
                            </ResourceMeta>
                          </SidebarListItem>
                        ))}
                      </div>
                    ) : null}
                  </>
                ),
                projectConfigItemCount,
              )}
              {renderSection(
                "images",
                <>
                  <div className="flex items-center justify-between gap-2 px-2 py-1">
                    <div className="min-w-0 truncate ui-text-sm text-text-lighter">
                      Build and run local images
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      compact
                      className="h-6 px-1.5 ui-text-sm"
                      disabled={busyImageId !== null}
                      onClick={openBuildDialog}
                    >
                      <ImageIcon className="size-3.5" />
                      Build
                    </Button>
                  </div>
                  {dockerOutput ? (
                    <div className="mx-2 mb-1 max-h-16 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-primary-bg px-2 py-1 font-mono text-[11px] text-text-lighter">
                      {dockerOutput}
                    </div>
                  ) : null}
                  {filteredImages.length > 0 ? (
                    filteredImages.map((image) => (
                      <ImageRow
                        key={`${image.id}-${image.tag}`}
                        image={image}
                        busy={busyImageId === image.id || busyImageId === getImageReference(image)}
                        onRun={openRunDialog}
                        onRemove={(nextImage) => void handleImageRemove(nextImage)}
                      />
                    ))
                  ) : (
                    <SidebarSectionLabel>No matching images</SidebarSectionLabel>
                  )}
                </>,
                filteredImages.length,
              )}
              {renderSection(
                "registry",
                <>
                  <div className="space-y-1 px-2 py-1">
                    <div className="flex items-center gap-1">
                      <div className="flex min-w-0 flex-1 items-center gap-1 rounded border border-border/70 bg-primary-bg px-1.5">
                        <Search className="size-3.5 shrink-0 text-text-lighter" />
                        <input
                          value={registryQuery}
                          onChange={(event) => setRegistryQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleRegistrySearch();
                          }}
                          placeholder="Search Docker Hub"
                          className="h-6 min-w-0 flex-1 bg-transparent ui-text-sm text-text outline-none placeholder:text-text-lighter"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        compact
                        className="h-6 px-1.5 ui-text-sm"
                        disabled={isRegistryBusy || !registryQuery.trim()}
                        onClick={() => void handleRegistrySearch()}
                      >
                        {isRegistryBusy ? <LoadingIndicator compact /> : "Search"}
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <Input
                        value={registryDraft.image}
                        onChange={(event) =>
                          setRegistryDraft((current) => ({
                            ...current,
                            image: event.target.value,
                          }))
                        }
                        placeholder="image:tag"
                        size="xs"
                      />
                      <Input
                        value={registryDraft.target}
                        onChange={(event) =>
                          setRegistryDraft((current) => ({
                            ...current,
                            target: event.target.value,
                          }))
                        }
                        placeholder="target tag"
                        size="xs"
                      />
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          compact
                          className="h-6 px-1.5 ui-text-sm"
                          disabled={isRegistryBusy || !registryDraft.image.trim()}
                          onClick={() => void handleRegistryPull(registryDraft.image)}
                        >
                          Pull
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          compact
                          className="h-6 px-1.5 ui-text-sm"
                          disabled={isRegistryBusy || !registryDraft.image.trim()}
                          onClick={() => void handleRegistryPush()}
                        >
                          Push
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          compact
                          className="h-6 px-1.5 ui-text-sm"
                          disabled={
                            isRegistryBusy ||
                            !registryDraft.image.trim() ||
                            !registryDraft.target.trim()
                          }
                          onClick={() => void handleTagImage()}
                        >
                          Tag
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <Input
                        value={registryDraft.registry}
                        onChange={(event) =>
                          setRegistryDraft((current) => ({
                            ...current,
                            registry: event.target.value,
                          }))
                        }
                        placeholder="registry"
                        size="xs"
                      />
                      <Input
                        value={registryDraft.username}
                        onChange={(event) =>
                          setRegistryDraft((current) => ({
                            ...current,
                            username: event.target.value,
                          }))
                        }
                        placeholder="username"
                        size="xs"
                      />
                      <div className="flex items-center gap-1">
                        <Input
                          value={registryDraft.password}
                          onChange={(event) =>
                            setRegistryDraft((current) => ({
                              ...current,
                              password: event.target.value,
                            }))
                          }
                          type="password"
                          placeholder="password"
                          size="xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          compact
                          className="h-6 px-1.5 ui-text-sm"
                          disabled={
                            isRegistryBusy ||
                            !registryDraft.username.trim() ||
                            !registryDraft.password
                          }
                          onClick={() => void handleRegistryLogin()}
                        >
                          Login
                        </Button>
                      </div>
                    </div>
                  </div>
                  {registryError ? (
                    <div className="mx-2 mb-1 whitespace-pre-wrap rounded border border-error/30 bg-error/8 px-2 py-1 ui-text-sm text-error">
                      {registryError}
                    </div>
                  ) : null}
                  {registryOutput ? (
                    <div className="mx-2 mb-1 max-h-16 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-primary-bg px-2 py-1 font-mono text-[11px] text-text-lighter">
                      {registryOutput}
                    </div>
                  ) : null}
                  {registryResults.length > 0 ? (
                    registryResults.map((result) => (
                      <SidebarListItem
                        key={result.name}
                        leading={
                          <ImageIcon className="size-4 text-text-lighter" weight="duotone" />
                        }
                        trailing={
                          <Button
                            type="button"
                            variant="ghost"
                            compact
                            className="h-6 px-1.5 ui-text-sm"
                            disabled={isRegistryBusy}
                            onClick={() => void handleRegistryPull(result.name)}
                          >
                            Pull
                          </Button>
                        }
                      >
                        <ResourceTitle>{result.name}</ResourceTitle>
                        <ResourceMeta>
                          {result.starCount ? `${result.starCount} stars` : "Registry image"}
                          {result.official === "[OK]" ? " · official" : ""}
                          {result.automated === "[OK]" ? " · automated" : ""}
                        </ResourceMeta>
                        {result.description ? (
                          <ResourceMeta>{result.description}</ResourceMeta>
                        ) : null}
                      </SidebarListItem>
                    ))
                  ) : (
                    <SidebarSectionLabel>Search, pull, push, tag, or log in</SidebarSectionLabel>
                  )}
                </>,
                registryResults.length,
              )}
              {renderSection(
                "cleanup",
                <div className="grid grid-cols-2 gap-1 px-2 py-1">
                  {(
                    [
                      ["containers", "Containers"],
                      ["images", "Images"],
                      ["volumes", "Volumes"],
                      ["networks", "Networks"],
                      ["system", "System"],
                    ] as Array<[DockerPruneTarget, string]>
                  ).map(([target, label]) => (
                    <Button
                      key={target}
                      type="button"
                      variant="ghost"
                      compact
                      className="h-7 justify-start px-2 ui-text-sm"
                      disabled={busyPruneTarget !== null}
                      onClick={() => void handlePrune(target, target === "system")}
                    >
                      {busyPruneTarget === target ? (
                        <LoadingIndicator compact />
                      ) : (
                        <Trash className="size-3.5" />
                      )}
                      Prune {label}
                    </Button>
                  ))}
                </div>,
                5,
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
                  filteredNetworks.map((network) => (
                    <NetworkRow key={network.id} network={network} />
                  ))
                ) : (
                  <SidebarSectionLabel>No matching networks</SidebarSectionLabel>
                ),
                filteredNetworks.length,
              )}
            </div>

            {activeTab === "resources" && selectedContainer ? (
              <div className="max-h-72 shrink-0 border-t border-border/70 bg-secondary-bg/35">
                <div className="flex h-8 items-center justify-between gap-2 px-2">
                  <div className="min-w-0">
                    <div className="truncate ui-text-sm font-medium text-text">
                      {selectedContainer.name}
                    </div>
                    <div className="ui-text-sm text-text-lighter">
                      {detailTab === "logs"
                        ? logStreamId
                          ? "Streaming logs"
                          : "Logs stopped"
                        : containerPath}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {(["logs", "files"] as DockerDetailTab[]).map((tab) => (
                      <Button
                        key={tab}
                        type="button"
                        variant={detailTab === tab ? "accent" : "ghost"}
                        compact
                        className="h-6 px-1.5 ui-text-sm capitalize"
                        onClick={() => setDetailTab(tab)}
                      >
                        {tab}
                      </Button>
                    ))}
                    {detailTab === "logs" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        compact
                        className="h-6 px-1.5 ui-text-sm"
                        disabled={logLines.length === 0}
                        onClick={() => setLogLines([])}
                      >
                        Clear
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        compact
                        className="h-6 px-1.5 ui-text-sm"
                        onClick={() => void handleCopyToContainer()}
                      >
                        <Upload className="size-3.5" />
                        Copy In
                      </Button>
                    )}
                  </div>
                </div>
                {detailTab === "logs" ? (
                  <>
                    <div className="flex items-center gap-1 border-t border-border/50 px-2 py-1">
                      <div className="flex min-w-0 flex-1 items-center gap-1 rounded border border-border/70 bg-primary-bg px-1.5">
                        <Search className="size-3.5 shrink-0 text-text-lighter" />
                        <input
                          value={logQuery}
                          onChange={(event) => setLogQuery(event.target.value)}
                          placeholder="Search logs"
                          className="h-6 min-w-0 flex-1 bg-transparent ui-text-sm text-text outline-none placeholder:text-text-lighter"
                        />
                      </div>
                      {(["all", "stderr", "errors"] as DockerLogFilter[]).map((filter) => (
                        <Button
                          key={filter}
                          type="button"
                          variant={logFilter === filter ? "accent" : "ghost"}
                          compact
                          className="h-6 px-1.5 ui-text-sm capitalize"
                          onClick={() => setLogFilter(filter)}
                        >
                          {filter === "stderr" ? "Err" : filter}
                        </Button>
                      ))}
                    </div>
                    {logError ? (
                      <div className="border-t border-border/50 px-2 py-1 ui-text-sm text-error">
                        {logError}
                      </div>
                    ) : null}
                    <div className="max-h-36 overflow-auto border-t border-border/50 px-2 py-1 font-mono text-[11px] leading-4">
                      {filteredLogLines.length > 0 ? (
                        filteredLogLines.map((entry) => (
                          <div
                            key={entry.id}
                            className={cn(
                              "whitespace-pre-wrap break-words",
                              entry.stream === "stderr" ? "text-error" : "text-text-lighter",
                            )}
                          >
                            {entry.line}
                          </div>
                        ))
                      ) : (
                        <div className="text-text-lighter">
                          {logLines.length > 0 ? "No matching log lines." : "Waiting for logs."}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1 border-t border-border/50 px-2 py-1">
                      <Button
                        type="button"
                        variant="ghost"
                        compact
                        className="h-6 px-1.5 ui-text-sm"
                        disabled={containerPath === "/"}
                        onClick={() => setContainerPath(parentContainerPath(containerPath))}
                      >
                        Up
                      </Button>
                      <div className="min-w-0 flex-1 truncate rounded border border-border/70 bg-primary-bg px-2 py-1 font-mono text-[11px] text-text-lighter">
                        {containerPath}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        compact
                        className="h-6 px-1.5 ui-text-sm"
                        disabled={isFilesLoading}
                        onClick={() => void loadContainerFiles()}
                      >
                        {isFilesLoading ? (
                          <LoadingIndicator compact />
                        ) : (
                          <Refresh className="size-3.5" />
                        )}
                      </Button>
                    </div>
                    {filesError ? (
                      <div className="border-t border-border/50 px-2 py-1 ui-text-sm text-error">
                        {filesError}
                      </div>
                    ) : null}
                    <div className="max-h-44 overflow-auto border-t border-border/50 py-1">
                      {isFilesLoading ? (
                        <div className="px-2 py-2 ui-text-sm text-text-lighter">
                          Loading files...
                        </div>
                      ) : containerFiles.length > 0 ? (
                        containerFiles.map((entry) => (
                          <div
                            key={entry.path}
                            role="button"
                            tabIndex={entry.isDirectory ? 0 : -1}
                            className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-hover"
                            onClick={() => {
                              if (entry.isDirectory) setContainerPath(entry.path);
                            }}
                            onKeyDown={(event) => {
                              if (!entry.isDirectory) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setContainerPath(entry.path);
                              }
                            }}
                          >
                            {entry.isDirectory ? (
                              <FolderIcon
                                className="size-4 shrink-0 text-text-lighter"
                                weight="duotone"
                              />
                            ) : (
                              <FileIcon
                                className="size-4 shrink-0 text-text-lighter"
                                weight="duotone"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate ui-text-sm text-text">{entry.name}</div>
                              <div className="truncate ui-text-sm text-text-lighter">
                                {entry.isDirectory ? "Directory" : formatFileSize(entry.size)}
                                {entry.mode ? ` · ${entry.mode}` : ""}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              compact
                              className="h-6 px-1.5 ui-text-sm"
                              tooltip="Copy to host"
                              tooltipSide="left"
                              aria-label={`Copy ${entry.name} to host`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleCopyFromContainer(entry);
                              }}
                            >
                              <Download className="size-3.5" weight="fill" />
                            </Button>
                          </div>
                        ))
                      ) : (
                        <div className="px-2 py-2 ui-text-sm text-text-lighter">
                          No files found.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
      </SidebarPanel>

      {dialogMode ? (
        <Dialog
          title={
            dialogMode === "build"
              ? "Build Docker Image"
              : dialogMode === "run"
                ? "Run Docker Image"
                : envDraft.relativePath
          }
          icon={dialogMode === "build" ? ImageIcon : dialogMode === "run" ? Play : FileIcon}
          onClose={() => setDialogMode(null)}
          size="md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogMode(null)}>
                Cancel
              </Button>
              {dialogMode === "build" ? (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => void handleSaveBuildPreset()}
                    disabled={!rootFolderPath || !buildDraft.contextPath.trim()}
                  >
                    Save Preset
                  </Button>
                  <Button onClick={handleBuildImage} disabled={!buildDraft.contextPath.trim()}>
                    Build
                  </Button>
                </>
              ) : dialogMode === "run" ? (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => void handleSaveRunPreset()}
                    disabled={!rootFolderPath || !runDraft.image.trim()}
                  >
                    Save Preset
                  </Button>
                  <Button onClick={handleRunImage} disabled={!runDraft.image.trim()}>
                    Run
                  </Button>
                </>
              ) : (
                <Button onClick={() => void handleSaveEnvFile()} disabled={!envDraft.path}>
                  Save
                </Button>
              )}
            </>
          }
        >
          {dialogMode === "build" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="docker-build-context" className="ui-text-sm block text-text">
                  Context Path
                </label>
                <Input
                  id="docker-build-context"
                  value={buildDraft.contextPath}
                  onChange={(event) =>
                    setBuildDraft((current) => ({
                      ...current,
                      contextPath: event.target.value,
                    }))
                  }
                  placeholder="/path/to/project"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="docker-build-file" className="ui-text-sm block text-text">
                  Dockerfile
                </label>
                <Input
                  id="docker-build-file"
                  value={buildDraft.dockerfilePath}
                  onChange={(event) =>
                    setBuildDraft((current) => ({
                      ...current,
                      dockerfilePath: event.target.value,
                    }))
                  }
                  placeholder="/path/to/Dockerfile"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="docker-build-tag" className="ui-text-sm block text-text">
                  Tag
                </label>
                <Input
                  id="docker-build-tag"
                  value={buildDraft.tag}
                  onChange={(event) =>
                    setBuildDraft((current) => ({ ...current, tag: event.target.value }))
                  }
                  placeholder="my-app:latest"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="docker-build-args" className="ui-text-sm block text-text">
                  Build Args
                </label>
                <Textarea
                  id="docker-build-args"
                  value={buildDraft.buildArgs}
                  onChange={(event) =>
                    setBuildDraft((current) => ({
                      ...current,
                      buildArgs: event.target.value,
                    }))
                  }
                  placeholder="NODE_ENV=production"
                  className="min-h-20 font-mono"
                />
              </div>
            </div>
          ) : dialogMode === "run" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="docker-run-image" className="ui-text-sm block text-text">
                  Image
                </label>
                <Input
                  id="docker-run-image"
                  value={runDraft.image}
                  onChange={(event) =>
                    setRunDraft((current) => ({ ...current, image: event.target.value }))
                  }
                  placeholder="nginx:latest"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="docker-run-name" className="ui-text-sm block text-text">
                  Container Name
                </label>
                <Input
                  id="docker-run-name"
                  value={runDraft.name}
                  onChange={(event) =>
                    setRunDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="my-container"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="docker-run-ports" className="ui-text-sm block text-text">
                    Ports
                  </label>
                  <Textarea
                    id="docker-run-ports"
                    value={runDraft.ports}
                    onChange={(event) =>
                      setRunDraft((current) => ({ ...current, ports: event.target.value }))
                    }
                    placeholder="8080:80"
                    className="min-h-20 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="docker-run-volumes" className="ui-text-sm block text-text">
                    Volumes
                  </label>
                  <Textarea
                    id="docker-run-volumes"
                    value={runDraft.volumes}
                    onChange={(event) =>
                      setRunDraft((current) => ({ ...current, volumes: event.target.value }))
                    }
                    placeholder="/host:/container"
                    className="min-h-20 font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="docker-run-env" className="ui-text-sm block text-text">
                  Environment
                </label>
                <Textarea
                  id="docker-run-env"
                  value={runDraft.env}
                  onChange={(event) =>
                    setRunDraft((current) => ({ ...current, env: event.target.value }))
                  }
                  placeholder="KEY=value"
                  className="min-h-20 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="docker-run-env-files" className="ui-text-sm block text-text">
                  Env Files
                </label>
                <Textarea
                  id="docker-run-env-files"
                  value={runDraft.envFiles}
                  onChange={(event) =>
                    setRunDraft((current) => ({ ...current, envFiles: event.target.value }))
                  }
                  placeholder=".env"
                  className="min-h-16 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="docker-run-command" className="ui-text-sm block text-text">
                  Command
                </label>
                <Input
                  id="docker-run-command"
                  value={runDraft.command}
                  onChange={(event) =>
                    setRunDraft((current) => ({ ...current, command: event.target.value }))
                  }
                  placeholder="npm start"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded border border-border/60 bg-primary-bg px-2 py-1 font-mono text-[11px] text-text-lighter">
                {envDraft.path}
              </div>
              <Textarea
                value={envDraft.content}
                onChange={(event) =>
                  setEnvDraft((current) => ({ ...current, content: event.target.value }))
                }
                className="min-h-80 font-mono"
              />
            </div>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
