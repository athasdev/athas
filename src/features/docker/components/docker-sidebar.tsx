import {
  ArrowClockwiseIcon as Refresh,
  ArrowFatLineDownIcon as Down,
  ArrowSquareOutIcon as OpenExternal,
  BugIcon as Bug,
  FileIcon,
  PlayIcon as Play,
  StackIcon as ImageIcon,
  SlidersHorizontalIcon as Sliders,
  TrashIcon as Trash,
} from "@/ui/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/accordion";
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
import { Empty, EmptyDescription, EmptyState } from "@/ui/empty";
import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { showPromptDialog } from "@/ui/dialog";
import {
  SidebarSearchPopover,
  SidebarSectionLabel,
  SidebarTabBar,
  SidebarWorkspace,
} from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import {
  buildDockerImage,
  copyFromDockerContainer,
  copyToDockerContainer,
  deleteDockerEnvFile,
  getDockerComposeProject,
  getDockerProjectConfig,
  openDockerEnvFile,
  openDockerDevContainer,
  pruneDockerResources,
  runDockerComposeAction,
  runDockerContainerAction,
  runDockerImage,
  runDockerImageAction,
  saveDockerProjectConfig,
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
  DockerProjectConfig,
  DockerRunPreset,
} from "../types/docker.types";
import {
  getDockerDebugCommand as dockerDebugCommand,
  getDockerErrorMessage as getErrorMessage,
  getDockerExecCommand as dockerExecCommand,
  getDockerFileName as fileName,
  getDockerImageReference as getImageReference,
  includesDockerQuery as includesQuery,
  isDockerConnectionError,
  splitDockerConfigLines as splitConfigLines,
} from "../utils/docker-sidebar-utils";
import {
  DockerCapabilityNotice,
  DockerInlineError,
  DockerUnavailableState,
} from "./docker-sidebar-states";
import { DockerImageDialog, type DockerImageDialogMode } from "./docker-image-dialog";
import { DockerContainerDetail, type DockerContainerDetailTab } from "./docker-container-detail";
import { DockerRegistrySection } from "./docker-registry-section";
import {
  ComposeServiceRow,
  ContainerRow,
  DockerActionMenu,
  DockerResourceRow,
  ImageRow,
  NetworkRow,
  VolumeRow,
} from "./docker-resource-rows";
import { useDockerInventory } from "../hooks/use-docker-inventory";
import { useDockerContainerLogs } from "../hooks/use-docker-container-logs";
import { useDockerContainerFiles } from "../hooks/use-docker-container-files";
import { useDockerRegistry } from "../hooks/use-docker-registry";

type DockerSection =
  | "containers"
  | "compose"
  | "project"
  | "images"
  | "registry"
  | "volumes"
  | "networks"
  | "cleanup";
type DockerTab = "resources" | "compose" | "project" | "registry";
type DockerContainerFilter = "all" | "running" | "stopped";

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

function openDebuggerPane() {
  const state = useUIState.getState();
  state.setBottomPaneActiveTab("debugger");
  state.setIsBottomPaneVisible(true);
}

export function DockerSidebar() {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const {
    inventory,
    selectedContainerId,
    selectedContainer,
    isLoading,
    connectionError,
    error,
    loadInventory,
    markDockerUnavailable,
    handleDockerFailure,
    clearError,
    selectContainer,
  } = useDockerInventory();
  const [detailTab, setDetailTab] = useState<DockerContainerDetailTab>("logs");
  const {
    lines: logLines,
    query: logQuery,
    filter: logFilter,
    streamId: logStreamId,
    error: logError,
    filteredLines: filteredLogLines,
    clearLines: clearLogLines,
    setQuery: setLogQuery,
    setFilter: setLogFilter,
  } = useDockerContainerLogs(selectedContainerId);
  const {
    path: containerPath,
    files: containerFiles,
    isLoading: isFilesLoading,
    error: filesError,
    loadFiles: loadContainerFiles,
    setPath: setContainerPath,
    clearError: clearFilesError,
    reportError: reportFilesError,
  } = useDockerContainerFiles(selectedContainerId, detailTab === "files");
  const {
    query: registryQuery,
    results: registryResults,
    error: registryError,
    output: registryOutput,
    isBusy: isRegistryBusy,
    draft: registryDraft,
    search: handleRegistrySearch,
    login: handleRegistryLogin,
    pull: handleRegistryPull,
    push: handleRegistryPush,
    tag: handleTagImage,
    setQuery: setRegistryQuery,
    setDraftField: setRegistryDraftField,
    dismissError: dismissRegistryError,
  } = useDockerRegistry({
    onDockerUnavailable: markDockerUnavailable,
    onInventoryChanged: loadInventory,
  });
  const [composeProject, setComposeProject] = useState<DockerComposeProject>(emptyComposeProject);
  const [projectConfig, setProjectConfig] = useState<DockerProjectConfig>(emptyProjectConfig);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<DockerTab>("resources");
  const [containerFilter, setContainerFilter] = useState<DockerContainerFilter>("all");
  const [collapsedSections, setCollapsedSections] = useState<Set<DockerSection>>(() => new Set());
  const [isComposeLoading, setIsComposeLoading] = useState(false);
  const [isProjectConfigLoading, setIsProjectConfigLoading] = useState(false);
  const [busyContainerId, setBusyContainerId] = useState<string | null>(null);
  const [busyComposeService, setBusyComposeService] = useState<string | null>(null);
  const [busyDevContainerPath, setBusyDevContainerPath] = useState<string | null>(null);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const [busyPruneTarget, setBusyPruneTarget] = useState<DockerPruneTarget | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [projectConfigError, setProjectConfigError] = useState<string | null>(null);
  const [composeOutput, setComposeOutput] = useState<string | null>(null);
  const [dockerOutput, setDockerOutput] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<DockerImageDialogMode | null>(null);
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
  const handleContainerAction = async (
    container: DockerContainer,
    action: DockerContainerAction,
  ) => {
    setBusyContainerId(container.id);
    clearError();
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
    clearError();
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
    clearError();
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
    clearError();
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
    clearError();
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

    clearFilesError();
    setDockerOutput(null);
    try {
      const output = await copyFromDockerContainer({
        containerId: selectedContainer.id,
        containerPath: entry.path,
        hostPath: hostPath.trim(),
      });
      setDockerOutput(output.trim() || `Copied ${entry.path} to ${hostPath.trim()}.`);
    } catch (copyError) {
      reportFilesError(copyError);
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

    clearFilesError();
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
      reportFilesError(copyError);
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

    if (!hasSectionHeader) {
      return (
        <section key={section} className={cn("min-w-0", !isVisible && "hidden")}>
          <div className="space-y-0.5">{rows}</div>
        </section>
      );
    }

    return (
      <Accordion
        key={section}
        value={isCollapsed ? [] : [section]}
        onValueChange={(value) =>
          setCollapsedSections((current) => {
            const next = new Set(current);
            if (value.includes(section)) next.delete(section);
            else next.add(section);
            return next;
          })
        }
        className={cn("min-w-0 pt-2 first:pt-0", !isVisible && "hidden")}
      >
        <AccordionItem value={section}>
          <AccordionTrigger count={filteredCount}>{title}</AccordionTrigger>
          <AccordionContent>{rows}</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  };

  return (
    <>
      <SidebarWorkspace
        title="Docker"
        actions={
          <>
            <SidebarSearchPopover
              value={query}
              onChange={setQuery}
              placeholder="Search Docker"
              aria-label="Search Docker resources"
            />
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
          </>
        }
        className="font-sans select-none"
      >
        <SidebarTabBar items={dockerTabs} value={activeTab} onChange={setActiveTab} />

        {activeTab === "resources" && error && !connectionError ? (
          <DockerInlineError
            title="Docker action failed"
            error={error}
            onDismiss={clearError}
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
          <EmptyState
            layout="sidebar"
            message={<Spinner label="Loading Docker resources" showLabel compact />}
          />
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
          <EmptyState
            layout="sidebar"
            message={<Spinner label="Loading Docker Compose" showLabel compact />}
          />
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
                      onSelect={(nextContainer) => selectContainer(nextContainer.id)}
                      onAction={handleContainerAction}
                      onOpenTerminal={openContainerTerminal}
                      onDebug={(nextContainer) => void handleDebugContainer(nextContainer)}
                      onOpenUrl={openServiceUrl}
                    />
                  ))
                ) : (
                  <EmptyState layout="sidebar" message="No matching containers" />
                ),
                filteredContainers.length,
              )}
              {renderSection(
                "compose",
                composeError ? (
                  <Empty tone="error" role="alert">
                    <EmptyDescription>{composeError}</EmptyDescription>
                  </Empty>
                ) : !rootFolderPath ? (
                  <EmptyState
                    layout="sidebar"
                    message="Open a workspace to inspect Compose services"
                  />
                ) : composeProject.files.length === 0 ? (
                  <EmptyState layout="sidebar" message="No Compose files in this workspace" />
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
                      <EmptyState
                        layout="sidebar"
                        message={
                          composeProject.services.length > 0
                            ? "No matching Compose services"
                            : "No Compose services found"
                        }
                      />
                    )}
                  </>
                ),
                filteredComposeServices.length,
              )}
              {renderSection(
                "project",
                !rootFolderPath ? (
                  <EmptyState
                    layout="sidebar"
                    message="Open a workspace to manage Docker presets"
                  />
                ) : isProjectConfigLoading ? (
                  <EmptyState
                    layout="sidebar"
                    message={<Spinner label="Loading project Docker config" showLabel compact />}
                  />
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
                        <EmptyState
                          layout="sidebar"
                          message="No env files or presets in this workspace"
                        />
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
                    <EmptyState layout="sidebar" message="No matching images" />
                  )}
                </>,
                filteredImages.length,
              )}
              {renderSection(
                "registry",
                <DockerRegistrySection
                  query={registryQuery}
                  results={registryResults}
                  error={registryError}
                  output={registryOutput}
                  draft={registryDraft}
                  isBusy={isRegistryBusy}
                  isDockerDaemonReady={isDockerDaemonReady}
                  hasConnectionError={connectionError !== null}
                  onQueryChange={setRegistryQuery}
                  onDraftFieldChange={setRegistryDraftField}
                  onSearch={handleRegistrySearch}
                  onLogin={handleRegistryLogin}
                  onPull={handleRegistryPull}
                  onPush={handleRegistryPush}
                  onTag={handleTagImage}
                  onDismissError={dismissRegistryError}
                />,
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
                  <EmptyState layout="sidebar" message="No matching volumes" />
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
                  <EmptyState layout="sidebar" message="No matching networks" />
                ),
                filteredNetworks.length,
              )}
            </ScrollArea>

            {activeTab === "resources" && selectedContainer ? (
              <DockerContainerDetail
                container={selectedContainer}
                activeTab={detailTab}
                logStreamId={logStreamId}
                logLines={logLines}
                filteredLogLines={filteredLogLines}
                logQuery={logQuery}
                logFilter={logFilter}
                logError={logError}
                containerPath={containerPath}
                containerFiles={containerFiles}
                isFilesLoading={isFilesLoading}
                filesError={filesError}
                onTabChange={setDetailTab}
                onClearLogs={clearLogLines}
                onLogQueryChange={setLogQuery}
                onLogFilterChange={setLogFilter}
                onContainerPathChange={setContainerPath}
                onRefreshFiles={loadContainerFiles}
                onCopyToContainer={handleCopyToContainer}
                onCopyFromContainer={handleCopyFromContainer}
              />
            ) : null}
          </>
        )}
      </SidebarWorkspace>

      {dialogMode ? (
        <DockerImageDialog
          mode={dialogMode}
          buildDraft={buildDraft}
          runDraft={runDraft}
          hasWorkspace={Boolean(rootFolderPath)}
          isDockerDaemonReady={isDockerDaemonReady}
          connectionError={connectionError}
          setBuildDraft={setBuildDraft}
          setRunDraft={setRunDraft}
          onClose={() => setDialogMode(null)}
          onSaveBuildPreset={handleSaveBuildPreset}
          onSaveRunPreset={handleSaveRunPreset}
          onBuild={handleBuildImage}
          onRun={handleRunImage}
        />
      ) : null}
    </>
  );
}
