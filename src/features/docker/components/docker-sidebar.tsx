import {
  ArrowClockwiseIcon as Refresh,
  ArrowFatLineDownIcon as Down,
  ArrowSquareOutIcon as OpenExternal,
  BugIcon as Bug,
  DownloadSimpleIcon as Download,
  DotsThreeIcon as More,
  FileIcon,
  FolderIcon,
  FunnelIcon as Filter,
  MagnifyingGlassIcon as Search,
  PauseIcon as Pause,
  PlayIcon as Play,
  ArrowsClockwiseIcon as Restart,
  StackIcon as ImageIcon,
  StopIcon as Stop,
  SlidersHorizontalIcon as Sliders,
  TerminalWindowIcon as Terminal,
  TrashIcon as Trash,
  UploadSimpleIcon as Upload,
  WarningCircleIcon as WarningCircle,
  XIcon as X,
} from "@/ui/icons";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/ui/alert";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";
import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Dialog, { showPromptDialog } from "@/ui/dialog";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";
import {
  SidebarEmptyState,
  SidebarPanel,
  SidebarSectionHeader,
  SidebarSectionLabel,
  SidebarTabBar,
  SidebarTitleBar,
  SidebarToolbar,
} from "@/ui/sidebar";
import { SearchField } from "@/ui/search";
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
  runDockerComposeAction,
  runDockerContainerAction,
  runDockerImage,
  runDockerImageAction,
  saveDockerProjectConfig,
  searchDockerRegistry,
  startDockerContainerLogStream,
  stopDockerContainerLogStream,
  tagDockerImage,
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
type DockerDialogMode = "build" | "run" | null;
type DockerDetailTab = "logs" | "files";
type DockerTab = "resources" | "compose" | "project" | "registry";
type DockerContainerFilter = "all" | "running" | "stopped";

const maxLogLines = 1_000;
const dockerTabSections: Record<DockerTab, DockerSection[]> = {
  resources: ["containers", "images", "cleanup", "volumes", "networks"],
  compose: ["compose"],
  project: ["project"],
  registry: ["registry"],
};
const dockerTabs: Array<{ id: DockerTab; label: string }> = [
  { id: "resources", label: "Resources" },
  { id: "compose", label: "Compose" },
  { id: "project", label: "Project" },
  { id: "registry", label: "Registry" },
];
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isDockerConnectionError(message: string) {
  const normalizedMessage = message.toLowerCase();
  return [
    "cannot connect to the docker daemon",
    "docker cli was not found",
    "error during connect",
    "failed to connect",
    "is the docker daemon running",
    "permission denied while trying to connect to the docker api",
    "connection refused",
  ].some((fragment) => normalizedMessage.includes(fragment));
}

function getDockerUnavailableCopy(error: string) {
  if (error.toLowerCase().includes("docker cli was not found")) {
    return {
      title: "Docker CLI isn't available",
      description: "Install Docker or make sure the Docker CLI is available in Athas.",
    };
  }

  if (isDockerConnectionError(error)) {
    return {
      title: "Docker isn't running",
      description: "Athas can't connect to the active Docker context.",
    };
  }

  return {
    title: "Docker is unavailable",
    description: "Athas couldn't load Docker resources.",
  };
}

function openDockerConnectionDetailsBuffer(error: string) {
  const copy = getDockerUnavailableCopy(error);
  const content = `${copy.title}\n\n${copy.description}\n\nTechnical details\n${error}\n`;
  const bufferStore = useBufferStore.getState();
  const bufferId = bufferStore.actions.openContent({
    type: "editor",
    path: "docker://connection-details",
    name: "Docker Connection.log",
    content,
    isVirtual: true,
    readOnly: true,
    language: "log",
  });
  const openedBuffer = useBufferStore.getState().buffers.find((buffer) => buffer.id === bufferId);
  if (openedBuffer?.type === "editor") {
    useBufferStore.getState().actions.updateBuffer({
      ...openedBuffer,
      content,
      savedContent: content,
      isDirty: false,
      isVirtual: true,
      readOnly: true,
      language: "log",
    });
  }
}

function DockerUnavailableState({
  error,
  title,
  description,
  isRetrying,
  onRetry,
}: {
  error: string;
  title?: string;
  description?: string;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const fallbackCopy = getDockerUnavailableCopy(error);

  return (
    <Empty className="min-h-0 flex-none gap-3 px-4 py-5" role="status">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon" className="size-9 border border-border/70 bg-accent">
          <WarningCircle className="size-4.5 text-subtle-foreground" />
        </EmptyMedia>
        <EmptyTitle className="ui-text-base">{title ?? fallbackCopy.title}</EmptyTitle>
        <EmptyDescription className="max-w-[34ch]">
          {description ?? fallbackCopy.description}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-1.5">
        <Button type="button" variant="default" size="sm" disabled={isRetrying} onClick={onRetry}>
          {isRetrying ? <Spinner compact /> : <Refresh />}
          Retry
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => openDockerConnectionDetailsBuffer(error)}
        >
          <OpenExternal />
          Details
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function DockerInlineError({
  title,
  error,
  onDismiss,
  className,
}: {
  title: string;
  error: string;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <Alert tone="error" className={cn("min-w-0", className)}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="min-w-0 select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {error}
      </AlertDescription>
      <AlertAction>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          tooltip="Dismiss"
          tooltipSide="left"
          aria-label={`Dismiss ${title.toLowerCase()}`}
          onClick={onDismiss}
        >
          <X />
        </Button>
      </AlertAction>
    </Alert>
  );
}

function DockerCapabilityNotice({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Alert tone="warning" role="status" className={cn("mx-2 mb-2 w-auto", className)}>
      <WarningCircle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

interface DockerMenuAction {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

function DockerActionMenu({ label, actions }: { label: string; actions: DockerMenuAction[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            tooltip={label}
            tooltipSide="left"
            aria-label={label}
          />
        }
      >
        <More />
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

function includesQuery(values: Array<string | null | undefined>, query: string) {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

function DockerResourceRow({
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
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground ui-text-sm">
          {title}
        </span>
        {status}
      </span>
      {description ? (
        <span className="mt-0.5 block truncate text-subtle-foreground ui-text-sm">
          {description}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        "group/docker-row flex min-h-12 w-full min-w-0 items-center rounded-lg transition-colors hover:bg-accent/70",
        active && "bg-accent/80",
      )}
    >
      {onClick ? (
        <button
          type="button"
          className="min-w-0 flex-1 px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          onClick={onClick}
        >
          {content}
        </button>
      ) : (
        <div className="min-w-0 flex-1 px-2.5 py-2">{content}</div>
      )}
      {actions ? (
        <div className="mr-1 shrink-0 opacity-0 transition-opacity group-hover/docker-row:opacity-100 group-focus-within/docker-row:opacity-100">
          {actions}
        </div>
      ) : null}
    </div>
  );
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            tooltip="Container actions"
            tooltipSide="left"
            aria-label={`Actions for ${container.name}`}
          />
        }
      >
        <More className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={busy || isRunning || isPaused}
          onClick={() => onAction(container, "start")}
        >
          <Play />
          Start
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy || !isRunning} onClick={() => onAction(container, "stop")}>
          <Stop />
          Stop
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy || (!isRunning && !isPaused)}
          onClick={() => onAction(container, isPaused ? "unpause" : "pause")}
        >
          {isPaused ? <Play /> : <Pause />}
          {isPaused ? "Unpause" : "Pause"}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => onAction(container, "restart")}>
          <Restart />
          Restart
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy || !isRunning} onClick={() => onOpenTerminal(container)}>
          <Terminal />
          Open shell
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy || !isRunning} onClick={() => onDebug(container)}>
          <Bug />
          Debug
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy || !quickUrl}
          onClick={() => {
            if (quickUrl) onOpenUrl(quickUrl);
          }}
        >
          <OpenExternal />
          Open service URL
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={busy || isRunning}
          onClick={() => onAction(container, "remove")}
        >
          <Trash />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <DockerResourceRow
      active={selected}
      title={container.name}
      status={
        <Badge variant={getContainerStateVariant(container)} size="compact" className="capitalize">
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
            size="icon-xs"
            tooltip="Service actions"
            tooltipSide="left"
            aria-label={`Actions for ${service.name}`}
          />
        }
      >
        <More className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={busy} onClick={() => onAction(service, "up")}>
          <Play />
          Start
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy || !isRunning} onClick={() => onAction(service, "stop")}>
          <Stop />
          Stop
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => onAction(service, "restart")}>
          <Restart />
          Restart
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => onAction(service, "rebuild")}>
          <ImageIcon />
          Rebuild
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={busy || !quickUrl}
          onClick={() => {
            if (quickUrl) onOpenUrl(quickUrl);
          }}
        >
          <OpenExternal />
          Open service URL
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <DockerResourceRow
      title={service.name}
      status={
        <Badge variant={getComposeServiceVariant(service)} size="compact" className="capitalize">
          {service.health ?? service.state}
        </Badge>
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
    <DockerResourceRow
      title={label}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                tooltip="Image actions"
                tooltipSide="left"
                aria-label={`Actions for ${label}`}
              />
            }
          >
            <More className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={busy} onClick={() => onRun(image)}>
              <Play />
              Run
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => onRemove(image)}>
              <Trash />
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

function VolumeRow({ volume }: { volume: DockerVolume }) {
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

function NetworkRow({ network }: { network: DockerNetwork }) {
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

export function DockerSidebar() {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const [inventory, setInventory] = useState<DockerInventory>(emptyInventory);
  const [composeProject, setComposeProject] = useState<DockerComposeProject>(emptyComposeProject);
  const [projectConfig, setProjectConfig] = useState<DockerProjectConfig>(emptyProjectConfig);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<DockerTab>("resources");
  const [containerFilter, setContainerFilter] = useState<DockerContainerFilter>("all");
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<DockerSection>>(() => new Set());
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
  const [connectionError, setConnectionError] = useState<string | null>(null);
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
  const loadInventory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextInventory = await getDockerInventory();
      setConnectionError(null);
      setInventory(nextInventory);
      setSelectedContainerId((current) => {
        if (current && nextInventory.containers.some((container) => container.id === current)) {
          return current;
        }
        return nextInventory.containers[0]?.id ?? null;
      });
    } catch (loadError) {
      setConnectionError(getErrorMessage(loadError));
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
    if (activeTab === "resources" || activeTab === "registry") {
      void loadInventory();
      return;
    }
    if (activeTab === "compose") {
      void loadComposeProject();
      void loadInventory();
      return;
    }
    void loadProjectConfig();
  }, [activeTab, loadComposeProject, loadInventory, loadProjectConfig]);

  const markDockerUnavailable = useCallback((message: string) => {
    setConnectionError(message);
    setError(null);
    setInventory(emptyInventory);
    setSelectedContainerId(null);
    setLogLines([]);
  }, []);

  const handleDockerFailure = useCallback(
    (failure: unknown) => {
      const message = getErrorMessage(failure);
      if (isDockerConnectionError(message)) {
        markDockerUnavailable(message);
        return;
      }
      setError(message);
    },
    [markDockerUnavailable],
  );

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
  const filteredContainers = inventory.containers.filter((container) => {
    if (containerFilter === "running" && container.state !== "running") return false;
    if (containerFilter === "stopped" && container.state === "running") return false;

    return includesQuery(
      [
        container.name,
        container.image,
        container.status,
        container.state,
        container.ports,
        container.size,
      ],
      normalizedQuery,
    );
  });
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
      handleDockerFailure(actionError);
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
      const message = getErrorMessage(actionError);
      if (isDockerConnectionError(message)) markDockerUnavailable(message);
      setComposeError(message);
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
      handleDockerFailure(buildError);
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
      handleDockerFailure(runError);
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
      const message = getErrorMessage(actionError);
      if (isDockerConnectionError(message)) markDockerUnavailable(message);
      setComposeError(message);
    } finally {
      setBusyComposeService(null);
    }
  };

  const openEnvFile = async (envFile: DockerEnvFile) => {
    setProjectConfigError(null);
    try {
      await handleFileSelect(envFile.path, false);
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
      const { file } = await openDockerEnvFile(rootFolderPath, envPath);
      await loadProjectConfig();
      await handleFileSelect(file.path, false);
    } catch (openError) {
      setProjectConfigError(openError instanceof Error ? openError.message : String(openError));
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
      const message = getErrorMessage(openError);
      if (isDockerConnectionError(message)) markDockerUnavailable(message);
      setProjectConfigError(message);
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
      handleDockerFailure(removeError);
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
      handleDockerFailure(pruneError);
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

  const handleRegistryFailure = (failure: unknown) => {
    const message = getErrorMessage(failure);
    if (isDockerConnectionError(message)) markDockerUnavailable(message);
    setRegistryError(message);
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
      handleRegistryFailure(searchError);
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
      handleRegistryFailure(loginError);
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
      handleRegistryFailure(pullError);
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
      handleRegistryFailure(pushError);
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
      handleRegistryFailure(tagError);
    } finally {
      setIsRegistryBusy(false);
    }
  };

  const isDockerDaemonReady = !isLoading && connectionError === null;
  const isActiveTabLoading =
    activeTab === "resources" || activeTab === "registry"
      ? isLoading
      : activeTab === "compose"
        ? isComposeLoading
        : isProjectConfigLoading;

  const renderSection = (section: DockerSection, rows: ReactNode, filteredCount?: number) => {
    const title = section === "cleanup" ? "Cleanup" : section[0].toUpperCase() + section.slice(1);
    const isVisible = dockerTabSections[activeTab].includes(section);
    const isCollapsed = collapsedSections.has(section);
    const hasSectionHeader = activeTab === "resources";

    return (
      <section
        key={section}
        className={cn("min-w-0", hasSectionHeader && "pt-2 first:pt-0", !isVisible && "hidden")}
      >
        {hasSectionHeader ? (
          <SidebarSectionHeader
            variant="surface"
            expanded={!isCollapsed}
            count={filteredCount}
            onToggle={() =>
              setCollapsedSections((current) => {
                const next = new Set(current);
                if (next.has(section)) {
                  next.delete(section);
                } else {
                  next.add(section);
                }
                return next;
              })
            }
          >
            {title}
          </SidebarSectionHeader>
        ) : null}
        {!hasSectionHeader || !isCollapsed ? <div className="space-y-0.5">{rows}</div> : null}
      </section>
    );
  };

  return (
    <>
      <SidebarPanel className="font-sans select-none">
        <SidebarTitleBar title="Docker">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            active={isFilterVisible || query.length > 0}
            tooltip="Search and filter"
            tooltipSide="bottom"
            aria-label="Search Docker resources"
            onClick={() => setIsFilterVisible((visible) => !visible)}
          >
            <Filter />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  active={containerFilter !== "all"}
                  tooltip="View options"
                  tooltipSide="bottom"
                  aria-label="Docker view options"
                />
              }
            >
              <Sliders />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={containerFilter}
                onValueChange={(value) => setContainerFilter(value as DockerContainerFilter)}
              >
                <DropdownMenuLabel>Containers</DropdownMenuLabel>
                <DropdownMenuRadioItem value="all" closeOnClick>
                  All
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="running" closeOnClick>
                  Running
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="stopped" closeOnClick>
                  Stopped
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={isActiveTabLoading} onClick={refreshDocker}>
                {isActiveTabLoading ? <Spinner compact /> : <Refresh />}
                Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarTitleBar>

        <SidebarTabBar
          items={dockerTabs}
          value={activeTab}
          onChange={(tab) => setActiveTab(tab as DockerTab)}
        />

        {isFilterVisible || query.length > 0 ? (
          <SidebarToolbar>
            <SearchField
              autoFocus
              value={query}
              onChange={setQuery}
              placeholder="Search Docker"
              aria-label="Search Docker"
              className="h-8 rounded-lg bg-surface/45"
            />
          </SidebarToolbar>
        ) : null}

        {activeTab === "resources" && error && !connectionError ? (
          <DockerInlineError
            title="Docker action failed"
            error={error}
            onDismiss={() => setError(null)}
            className="rounded-none border-x-0"
          />
        ) : null}

        {activeTab === "resources" && connectionError ? (
          <DockerUnavailableState
            error={connectionError}
            isRetrying={isLoading}
            onRetry={() => void loadInventory()}
          />
        ) : activeTab === "resources" && isLoading ? (
          <SidebarEmptyState className="flex-1">Loading Docker resources...</SidebarEmptyState>
        ) : activeTab === "compose" && composeError ? (
          <DockerUnavailableState
            error={composeError}
            title={
              isDockerConnectionError(composeError) ? undefined : "Docker Compose is unavailable"
            }
            description={
              isDockerConnectionError(composeError)
                ? undefined
                : "Athas couldn't load Compose services for this project."
            }
            isRetrying={isComposeLoading}
            onRetry={() => void loadComposeProject()}
          />
        ) : activeTab === "compose" && isComposeLoading ? (
          <SidebarEmptyState className="flex-1">Loading Docker Compose...</SidebarEmptyState>
        ) : (
          <>
            <ScrollArea className="min-h-0 flex-1" contentClassName="space-y-2 px-2 py-2">
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
                  <SidebarEmptyState>No matching containers</SidebarEmptyState>
                ),
                filteredContainers.length,
              )}
              {renderSection(
                "compose",
                composeError ? (
                  <SidebarEmptyState tone="error">{composeError}</SidebarEmptyState>
                ) : !rootFolderPath ? (
                  <SidebarEmptyState>
                    Open a workspace to inspect Compose services
                  </SidebarEmptyState>
                ) : composeProject.files.length === 0 ? (
                  <SidebarEmptyState>No Compose files in this workspace</SidebarEmptyState>
                ) : (
                  <>
                    <DockerResourceRow
                      title="Compose project"
                      description={composeProject.files.map(fileName).join(", ")}
                      status={
                        <Badge variant="muted" size="compact">
                          {composeProject.services.length} services
                        </Badge>
                      }
                      actions={
                        <DockerActionMenu
                          label="Compose project actions"
                          actions={[
                            {
                              label: "Start with env files",
                              icon: <FileIcon />,
                              disabled:
                                busyComposeService !== null || composeEnvFilePaths.length === 0,
                              onSelect: () =>
                                void handleComposeAction(null, "up", composeEnvFilePaths),
                            },
                            {
                              label: "Save preset",
                              disabled: busyComposeService !== null,
                              onSelect: () => void handleSaveComposePreset(),
                            },
                            {
                              label: "Stop project",
                              icon: <Down />,
                              disabled: busyComposeService !== null,
                              separatorBefore: true,
                              onSelect: () => void handleComposeAction(null, "down"),
                            },
                          ]}
                        />
                      }
                    />
                    {composeOutput ? (
                      <div className="ui-text-sm mx-2 mb-1 max-h-16 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background px-2 py-1 font-mono text-subtle-foreground">
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
                      <SidebarEmptyState>
                        {composeProject.services.length > 0
                          ? "No matching Compose services"
                          : "No Compose services found"}
                      </SidebarEmptyState>
                    )}
                  </>
                ),
                filteredComposeServices.length,
              )}
              {renderSection(
                "project",
                !rootFolderPath ? (
                  <SidebarEmptyState>Open a workspace to manage Docker presets</SidebarEmptyState>
                ) : isProjectConfigLoading ? (
                  <SidebarEmptyState role="status" aria-live="polite">
                    Loading project Docker config...
                  </SidebarEmptyState>
                ) : (
                  <>
                    {projectConfigError ? (
                      <DockerInlineError
                        title="Project Docker action failed"
                        error={projectConfigError}
                        onDismiss={() => setProjectConfigError(null)}
                        className="mx-2 mb-1 w-auto"
                      />
                    ) : null}
                    {connectionError ? (
                      <DockerCapabilityNotice>
                        Docker is offline. Project files and presets are still available.
                      </DockerCapabilityNotice>
                    ) : null}
                    {projectConfigItemCount === 0 ? (
                      <div className="space-y-1 px-2 py-1">
                        <SidebarEmptyState>
                          No env files or presets in this workspace
                        </SidebarEmptyState>
                        <div className="flex flex-wrap items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="h-6 px-1.5 ui-text-sm"
                            onClick={() => void handleOpenEnvFile()}
                          >
                            <FileIcon className="size-3.5" />
                            Env
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
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
                        <SidebarSectionLabel
                          trailing={
                            <DockerActionMenu
                              label="Project Docker actions"
                              actions={[
                                {
                                  label: "Open env file",
                                  icon: <FileIcon />,
                                  onSelect: () => void handleOpenEnvFile(),
                                },
                                {
                                  label: "Save debug preset",
                                  icon: <Bug />,
                                  onSelect: () => void handleSaveDebugPreset(),
                                },
                              ]}
                            />
                          }
                        >
                          Workspace
                        </SidebarSectionLabel>
                        {projectConfig.devContainers.length > 0 ? (
                          <div className="space-y-0.5">
                            <SidebarSectionLabel>Dev Containers</SidebarSectionLabel>
                            {projectConfig.devContainers.map((devContainer) => (
                              <DockerResourceRow
                                key={devContainer.configPath}
                                title={devContainer.name}
                                description={
                                  <>
                                    {devContainer.kind}
                                    {devContainer.service ? ` · ${devContainer.service}` : ""}
                                    {devContainer.image ? ` · ${devContainer.image}` : ""}
                                    {` · ${devContainer.relativePath}`}
                                  </>
                                }
                                actions={
                                  <DockerActionMenu
                                    label={`Actions for ${devContainer.name}`}
                                    actions={[
                                      {
                                        label:
                                          busyDevContainerPath === devContainer.configPath
                                            ? "Opening..."
                                            : "Open",
                                        icon:
                                          busyDevContainerPath === devContainer.configPath ? (
                                            <Spinner compact />
                                          ) : (
                                            <OpenExternal />
                                          ),
                                        disabled:
                                          !isDockerDaemonReady ||
                                          busyDevContainerPath !== null ||
                                          devContainer.kind === "unsupported",
                                        onSelect: () => void handleOpenDevContainer(devContainer),
                                      },
                                    ]}
                                  />
                                }
                              />
                            ))}
                          </div>
                        ) : null}
                        {projectConfig.workspaceDebugPresets.length > 0 ? (
                          <div className="space-y-0.5">
                            <SidebarSectionLabel>Launch configs</SidebarSectionLabel>
                            {projectConfig.workspaceDebugPresets.map((preset) => (
                              <DockerResourceRow
                                key={`${preset.source}-${preset.name}`}
                                title={preset.name}
                                description={
                                  <>
                                    {preset.command}
                                    {preset.workdir ? ` · ${preset.workdir}` : ""}
                                  </>
                                }
                                actions={
                                  <DockerActionMenu
                                    label={`Actions for ${preset.name}`}
                                    actions={[
                                      {
                                        label: "Run",
                                        icon: <Play />,
                                        disabled: !isDockerDaemonReady,
                                        onSelect: () => handleRunDebugPreset(preset),
                                      },
                                    ]}
                                  />
                                }
                              />
                            ))}
                          </div>
                        ) : null}
                        {projectConfig.debugPresets.length > 0 ? (
                          <div className="space-y-0.5">
                            <SidebarSectionLabel>Debug presets</SidebarSectionLabel>
                            {projectConfig.debugPresets.map((preset) => (
                              <DockerResourceRow
                                key={preset.name}
                                title={preset.name}
                                description={
                                  <>
                                    {preset.command}
                                    {preset.workdir ? ` · ${preset.workdir}` : ""}
                                  </>
                                }
                                actions={
                                  <DockerActionMenu
                                    label={`Actions for ${preset.name}`}
                                    actions={[
                                      {
                                        label: "Run",
                                        icon: <Play />,
                                        disabled: !isDockerDaemonReady,
                                        onSelect: () => handleRunDebugPreset(preset),
                                      },
                                      {
                                        label: "Delete",
                                        icon: <Trash />,
                                        destructive: true,
                                        separatorBefore: true,
                                        onSelect: () =>
                                          void handleDeletePreset("debug", preset.name),
                                      },
                                    ]}
                                  />
                                }
                              />
                            ))}
                          </div>
                        ) : null}
                        {projectConfig.envFiles.length > 0 ? (
                          <div className="space-y-0.5">
                            <SidebarSectionLabel>Env files</SidebarSectionLabel>
                            {projectConfig.envFiles.map((envFile) => (
                              <DockerResourceRow
                                key={envFile.path}
                                title={
                                  <>
                                    <FileIcon className="size-3.5 shrink-0 text-subtle-foreground" />
                                    {envFile.relativePath}
                                  </>
                                }
                                description={`${envFile.variableCount} ${
                                  envFile.variableCount === 1 ? "variable" : "variables"
                                }`}
                                onClick={() => void openEnvFile(envFile)}
                                actions={
                                  <DockerActionMenu
                                    label={`Actions for ${envFile.relativePath}`}
                                    actions={[
                                      {
                                        label: "Open",
                                        icon: <FileIcon />,
                                        onSelect: () => void openEnvFile(envFile),
                                      },
                                      {
                                        label: "Delete",
                                        icon: <Trash />,
                                        destructive: true,
                                        separatorBefore: true,
                                        onSelect: () => void handleDeleteEnvFile(envFile),
                                      },
                                    ]}
                                  />
                                }
                              />
                            ))}
                          </div>
                        ) : null}
                        {projectConfig.buildPresets.length > 0 ? (
                          <div className="space-y-0.5">
                            <SidebarSectionLabel>Build presets</SidebarSectionLabel>
                            {projectConfig.buildPresets.map((preset) => (
                              <DockerResourceRow
                                key={preset.name}
                                title={preset.name}
                                description={preset.tag || preset.contextPath}
                                actions={
                                  <DockerActionMenu
                                    label={`Actions for ${preset.name}`}
                                    actions={[
                                      {
                                        label: "Use preset",
                                        icon: <ImageIcon />,
                                        onSelect: () => applyBuildPreset(preset),
                                      },
                                      {
                                        label: "Delete",
                                        icon: <Trash />,
                                        destructive: true,
                                        separatorBefore: true,
                                        onSelect: () =>
                                          void handleDeletePreset("build", preset.name),
                                      },
                                    ]}
                                  />
                                }
                              />
                            ))}
                          </div>
                        ) : null}
                        {projectConfig.runPresets.length > 0 ? (
                          <div className="space-y-0.5">
                            <SidebarSectionLabel>Run presets</SidebarSectionLabel>
                            {projectConfig.runPresets.map((preset) => (
                              <DockerResourceRow
                                key={preset.name}
                                title={preset.name}
                                description={
                                  <>
                                    {preset.image}
                                    {preset.envFiles.length > 0 ? " · env file" : ""}
                                  </>
                                }
                                actions={
                                  <DockerActionMenu
                                    label={`Actions for ${preset.name}`}
                                    actions={[
                                      {
                                        label: "Use preset",
                                        icon: <Play />,
                                        onSelect: () => applyRunPreset(preset),
                                      },
                                      {
                                        label: "Delete",
                                        icon: <Trash />,
                                        destructive: true,
                                        separatorBefore: true,
                                        onSelect: () => void handleDeletePreset("run", preset.name),
                                      },
                                    ]}
                                  />
                                }
                              />
                            ))}
                          </div>
                        ) : null}
                        {projectConfig.composePresets.length > 0 ? (
                          <div className="space-y-0.5">
                            <SidebarSectionLabel>Compose presets</SidebarSectionLabel>
                            {projectConfig.composePresets.map((preset) => (
                              <DockerResourceRow
                                key={preset.name}
                                title={preset.name}
                                description={
                                  <>
                                    {preset.action}
                                    {preset.service ? ` · ${preset.service}` : ""}
                                  </>
                                }
                                actions={
                                  <DockerActionMenu
                                    label={`Actions for ${preset.name}`}
                                    actions={[
                                      {
                                        label:
                                          busyComposeService === `preset:${preset.name}`
                                            ? "Running..."
                                            : "Run",
                                        icon:
                                          busyComposeService === `preset:${preset.name}` ? (
                                            <Spinner compact />
                                          ) : (
                                            <Play />
                                          ),
                                        disabled:
                                          !isDockerDaemonReady || busyComposeService !== null,
                                        onSelect: () => void handleRunComposePreset(preset),
                                      },
                                      {
                                        label: "Delete",
                                        icon: <Trash />,
                                        destructive: true,
                                        separatorBefore: true,
                                        onSelect: () =>
                                          void handleDeletePreset("compose", preset.name),
                                      },
                                    ]}
                                  />
                                }
                              />
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                  </>
                ),
                projectConfigItemCount,
              )}
              {renderSection(
                "images",
                <>
                  <div className="flex items-center justify-between gap-2 px-2 py-1">
                    <div className="min-w-0 truncate ui-text-sm text-subtle-foreground">
                      Build and run local images
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="h-6 px-1.5 ui-text-sm"
                      disabled={busyImageId !== null}
                      onClick={openBuildDialog}
                    >
                      <ImageIcon className="size-3.5" />
                      Build
                    </Button>
                  </div>
                  {dockerOutput ? (
                    <div className="ui-text-sm mx-2 mb-1 max-h-16 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background px-2 py-1 font-mono text-subtle-foreground">
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
                    <SidebarEmptyState>No matching images</SidebarEmptyState>
                  )}
                </>,
                filteredImages.length,
              )}
              {renderSection(
                "registry",
                <>
                  {connectionError ? (
                    <DockerCapabilityNotice>
                      Search and login remain available. Start Docker to pull, push, or tag images.
                    </DockerCapabilityNotice>
                  ) : null}
                  <div className="space-y-3 px-2 py-2">
                    <div className="space-y-1">
                      <SidebarSectionLabel className="h-5 px-0">Docker Hub</SidebarSectionLabel>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <SearchField
                          value={registryQuery}
                          onChange={setRegistryQuery}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleRegistrySearch();
                          }}
                          placeholder="Search images"
                          aria-label="Search Docker Hub"
                          size="xs"
                          className="min-w-0 flex-1 rounded-lg"
                        />
                        <Button
                          type="button"
                          variant="default"
                          size="xs"
                          disabled={isRegistryBusy || !registryQuery.trim()}
                          onClick={() => void handleRegistrySearch()}
                        >
                          {isRegistryBusy ? <Spinner compact /> : <Search />}
                          Search
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <SidebarSectionLabel className="h-5 px-0">Image actions</SidebarSectionLabel>
                      <Input
                        value={registryDraft.image}
                        onChange={(event) =>
                          setRegistryDraft((current) => ({
                            ...current,
                            image: event.target.value,
                          }))
                        }
                        placeholder="Image, for example nginx:latest"
                        size="xs"
                        className="w-full rounded-lg"
                      />
                      <Input
                        value={registryDraft.target}
                        onChange={(event) =>
                          setRegistryDraft((current) => ({
                            ...current,
                            target: event.target.value,
                          }))
                        }
                        placeholder="Target tag"
                        size="xs"
                        className="w-full rounded-lg"
                      />
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={
                            isRegistryBusy || !isDockerDaemonReady || !registryDraft.image.trim()
                          }
                          onClick={() => void handleRegistryPull(registryDraft.image)}
                        >
                          Pull
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={
                            isRegistryBusy || !isDockerDaemonReady || !registryDraft.image.trim()
                          }
                          onClick={() => void handleRegistryPush()}
                        >
                          Push
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={
                            isRegistryBusy ||
                            !isDockerDaemonReady ||
                            !registryDraft.image.trim() ||
                            !registryDraft.target.trim()
                          }
                          onClick={() => void handleTagImage()}
                        >
                          Tag
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <SidebarSectionLabel className="h-5 px-0">Registry login</SidebarSectionLabel>
                      <Input
                        value={registryDraft.registry}
                        onChange={(event) =>
                          setRegistryDraft((current) => ({
                            ...current,
                            registry: event.target.value,
                          }))
                        }
                        placeholder="Registry (optional)"
                        size="xs"
                        className="w-full rounded-lg"
                      />
                      <Input
                        value={registryDraft.username}
                        onChange={(event) =>
                          setRegistryDraft((current) => ({
                            ...current,
                            username: event.target.value,
                          }))
                        }
                        placeholder="Username"
                        size="xs"
                        className="w-full rounded-lg"
                      />
                      <Input
                        value={registryDraft.password}
                        onChange={(event) =>
                          setRegistryDraft((current) => ({
                            ...current,
                            password: event.target.value,
                          }))
                        }
                        type="password"
                        placeholder="Password"
                        size="xs"
                        className="w-full rounded-lg"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
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
                  {registryError ? (
                    <DockerInlineError
                      title="Registry action failed"
                      error={registryError}
                      onDismiss={() => setRegistryError(null)}
                      className="mx-2 mb-1 w-auto"
                    />
                  ) : null}
                  {registryOutput ? (
                    <div className="ui-text-sm mx-2 mb-1 max-h-16 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background px-2 py-1 font-mono text-subtle-foreground">
                      {registryOutput}
                    </div>
                  ) : null}
                  {registryResults.length > 0 ? (
                    registryResults.map((result) => (
                      <DockerResourceRow
                        key={result.name}
                        title={result.name}
                        description={
                          <>
                            {result.starCount ? `${result.starCount} stars` : "Registry image"}
                            {result.official === "[OK]" ? " · official" : ""}
                            {result.automated === "[OK]" ? " · automated" : ""}
                            {result.description ? ` · ${result.description}` : ""}
                          </>
                        }
                        actions={
                          <DockerActionMenu
                            label={`Actions for ${result.name}`}
                            actions={[
                              {
                                label: "Pull",
                                icon: <Download />,
                                disabled: isRegistryBusy || !isDockerDaemonReady,
                                onSelect: () => void handleRegistryPull(result.name),
                              },
                            ]}
                          />
                        }
                      />
                    ))
                  ) : (
                    <SidebarEmptyState>Search Docker Hub to find images</SidebarEmptyState>
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
                      size="xs"
                      className="h-7 justify-start px-2 ui-text-sm"
                      disabled={busyPruneTarget !== null}
                      onClick={() => void handlePrune(target, target === "system")}
                    >
                      {busyPruneTarget === target ? (
                        <Spinner compact />
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
                  <SidebarEmptyState>No matching volumes</SidebarEmptyState>
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
                  <SidebarEmptyState>No matching networks</SidebarEmptyState>
                ),
                filteredNetworks.length,
              )}
            </ScrollArea>

            {activeTab === "resources" && selectedContainer ? (
              <div className="max-h-72 shrink-0 border-t border-border/70 bg-surface/35">
                <div className="flex h-8 items-center justify-between gap-2 px-2">
                  <div className="min-w-0">
                    <div className="truncate ui-text-sm font-medium text-foreground">
                      {selectedContainer.name}
                    </div>
                    <div className="ui-text-sm text-subtle-foreground">
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
                        size="xs"
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
                        size="xs"
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
                        size="xs"
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
                      <div className="flex min-w-0 flex-1 items-center gap-1 rounded border border-border/70 bg-background px-1.5">
                        <Search className="size-3.5 shrink-0 text-subtle-foreground" />
                        <input
                          value={logQuery}
                          onChange={(event) => setLogQuery(event.target.value)}
                          placeholder="Search logs"
                          className="h-6 min-w-0 flex-1 bg-transparent ui-text-sm text-foreground outline-none placeholder:text-subtle-foreground"
                        />
                      </div>
                      {(["all", "stderr", "errors"] as DockerLogFilter[]).map((filter) => (
                        <Button
                          key={filter}
                          type="button"
                          variant={logFilter === filter ? "accent" : "ghost"}
                          size="xs"
                          className="h-6 px-1.5 ui-text-sm capitalize"
                          onClick={() => setLogFilter(filter)}
                        >
                          {filter === "stderr" ? "Err" : filter}
                        </Button>
                      ))}
                    </div>
                    {logError ? (
                      <div className="border-t border-border/50 px-2 py-1 ui-text-sm text-destructive">
                        {logError}
                      </div>
                    ) : null}
                    <div className="ui-text-sm max-h-36 overflow-auto border-t border-border/50 px-2 py-1 font-mono leading-4">
                      {filteredLogLines.length > 0 ? (
                        filteredLogLines.map((entry) => (
                          <div
                            key={entry.id}
                            className={cn(
                              "whitespace-pre-wrap break-words",
                              entry.stream === "stderr"
                                ? "text-destructive"
                                : "text-subtle-foreground",
                            )}
                          >
                            {entry.line}
                          </div>
                        ))
                      ) : (
                        <div className="text-subtle-foreground">
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
                        size="xs"
                        className="h-6 px-1.5 ui-text-sm"
                        disabled={containerPath === "/"}
                        onClick={() => setContainerPath(parentContainerPath(containerPath))}
                      >
                        Up
                      </Button>
                      <div className="ui-text-sm min-w-0 flex-1 truncate rounded border border-border/70 bg-background px-2 py-1 font-mono text-subtle-foreground">
                        {containerPath}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="ui-text-sm"
                        disabled={isFilesLoading}
                        onClick={() => void loadContainerFiles()}
                      >
                        {isFilesLoading ? <Spinner compact /> : <Refresh className="size-3.5" />}
                      </Button>
                    </div>
                    {filesError ? (
                      <div className="border-t border-border/50 px-2 py-1 ui-text-sm text-destructive">
                        {filesError}
                      </div>
                    ) : null}
                    <div className="max-h-44 overflow-auto border-t border-border/50 py-1">
                      {isFilesLoading ? (
                        <div className="px-2 py-2 ui-text-sm text-subtle-foreground">
                          Loading files...
                        </div>
                      ) : containerFiles.length > 0 ? (
                        containerFiles.map((entry) => (
                          <div
                            key={entry.path}
                            role="button"
                            tabIndex={entry.isDirectory ? 0 : -1}
                            className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent"
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
                                className="size-4 shrink-0 text-subtle-foreground"
                                weight="duotone"
                              />
                            ) : (
                              <FileIcon
                                className="size-4 shrink-0 text-subtle-foreground"
                                weight="duotone"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate ui-text-sm text-foreground">
                                {entry.name}
                              </div>
                              <div className="truncate ui-text-sm text-subtle-foreground">
                                {entry.isDirectory ? "Directory" : formatFileSize(entry.size)}
                                {entry.mode ? ` · ${entry.mode}` : ""}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="ui-text-sm"
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
                        <SidebarEmptyState>No files found.</SidebarEmptyState>
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
          title={dialogMode === "build" ? "Build Docker Image" : "Run Docker Image"}
          icon={dialogMode === "build" ? ImageIcon : Play}
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
                  <Button
                    onClick={handleBuildImage}
                    disabled={!isDockerDaemonReady || !buildDraft.contextPath.trim()}
                  >
                    Build
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => void handleSaveRunPreset()}
                    disabled={!rootFolderPath || !runDraft.image.trim()}
                  >
                    Save Preset
                  </Button>
                  <Button
                    onClick={handleRunImage}
                    disabled={!isDockerDaemonReady || !runDraft.image.trim()}
                  >
                    Run
                  </Button>
                </>
              )}
            </>
          }
        >
          {(dialogMode === "build" || dialogMode === "run") && connectionError ? (
            <DockerCapabilityNotice className="mx-0 mb-3">
              Start Docker before{" "}
              {dialogMode === "build" ? "building this image" : "running this image"}. You can still
              save these values as a preset.
            </DockerCapabilityNotice>
          ) : null}
          {dialogMode === "build" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="docker-build-context" className="ui-text-sm block text-foreground">
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
                <label htmlFor="docker-build-file" className="ui-text-sm block text-foreground">
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
                <label htmlFor="docker-build-tag" className="ui-text-sm block text-foreground">
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
                <label htmlFor="docker-build-args" className="ui-text-sm block text-foreground">
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
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="docker-run-image" className="ui-text-sm block text-foreground">
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
                <label htmlFor="docker-run-name" className="ui-text-sm block text-foreground">
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
                  <label htmlFor="docker-run-ports" className="ui-text-sm block text-foreground">
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
                  <label htmlFor="docker-run-volumes" className="ui-text-sm block text-foreground">
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
                <label htmlFor="docker-run-env" className="ui-text-sm block text-foreground">
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
                <label htmlFor="docker-run-env-files" className="ui-text-sm block text-foreground">
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
                <label htmlFor="docker-run-command" className="ui-text-sm block text-foreground">
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
          )}
        </Dialog>
      ) : null}
    </>
  );
}
