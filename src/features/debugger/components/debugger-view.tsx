import {
  ArrowBendDownLeftIcon as ArrowBendDownLeft,
  ArrowDownIcon as ArrowDown,
  ArrowUpIcon as ArrowUp,
  ArrowsClockwiseIcon as ArrowsClockwise,
  ArrowsInIcon as Minimize,
  ArrowsOutIcon as Maximize,
  BugIcon as Bug,
  CircleIcon as Circle,
  FolderOpenIcon as FolderOpen,
  PauseIcon as Pause,
  PlayIcon as Play,
  SquareIcon as Square,
  TrashIcon as Trash,
  XIcon as X,
} from "@/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Alert, AlertDescription } from "@/ui/alert";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { EmptyState } from "@/ui/empty";
import Input from "@/ui/input";
import { ScrollArea } from "@/ui/scroll-area";
import Select from "@/ui/select";
import { TabBarSurface } from "@/ui/tab-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { cn } from "@/utils/cn";
import { joinPath } from "@/utils/path-helpers";
import {
  applyJavaHotCodeReplace,
  disconnectDebugAdapterSession,
  getExceptionBreakpointFilters,
  restartDebugAdapterSession,
  sendDebugAdapterRequest,
  startDebugLaunchSession,
  startJavaDebugLaunchSession,
  syncDebugBreakpoints,
  syncExceptionBreakpoints,
} from "../services/debug-adapter-service";
import { useDebuggerStore } from "../stores/debugger.store";
import {
  buildDebugCommand,
  createGeneratedDebugConfig,
  parseDebugLaunchJson,
  resolveDebugConfigVariables,
} from "../utils/debugger-command";
import {
  DebugBreakpointsList,
  DebugExceptionBreakpointsList,
  DebugSessionStatusIcon,
  DebugStackFrames,
} from "./debugger-panels";
import { DebugWatchPanel } from "./debugger-watch-panel";
import { DebugVariablesPanel } from "./debugger-variables-panel";

type DebuggerPanel = "stack" | "variables" | "watch" | "console" | "breakpoints";

interface DebuggerViewProps {
  isFullScreen: boolean;
  onClose: () => void;
  onFullScreen: () => void;
}
const getActiveDebuggableFile = (state: ReturnType<typeof useBufferStore.getState>) => {
  const activeBuffer = state.activeBufferId
    ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
    : null;
  if (!activeBuffer || activeBuffer.type !== "editor" || activeBuffer.isVirtual) return null;

  return {
    path: activeBuffer.path,
    name: activeBuffer.name,
    language: activeBuffer.language,
  };
};

function DebugStatusBadge({ status }: { status: "idle" | "running" | "paused" }) {
  const variant = status === "paused" ? "default" : status === "running" ? "accent" : "muted";

  return (
    <Badge variant={variant} className="gap-1.5 capitalize">
      <DebugSessionStatusIcon status={status} />
      {status}
    </Badge>
  );
}

export default function DebuggerView({ isFullScreen, onClose, onFullScreen }: DebuggerViewProps) {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const activeFile = useBufferStore(getActiveDebuggableFile);
  const handleFileOpen = useFileSystemStore.use.handleFileOpen?.();
  const breakpoints = useDebuggerStore.use.breakpoints();
  const watchExpressions = useDebuggerStore.use.watchExpressions();
  const workspaceConfigs = useDebuggerStore.use.workspaceConfigs();
  const userConfigs = useDebuggerStore.use.userConfigs();
  const activeConfigId = useDebuggerStore.use.activeConfigId();
  const activeSession = useDebuggerStore.use.activeSession();
  const threads = useDebuggerStore.use.threads();
  const stoppedState = useDebuggerStore.use.stoppedState();
  const stackFrames = useDebuggerStore.use.stackFrames();
  const selectedFrameId = useDebuggerStore.use.selectedFrameId();
  const scopes = useDebuggerStore.use.scopes();
  const variablesByReference = useDebuggerStore.use.variablesByReference();
  const adapterOutput = useDebuggerStore.use.adapterOutput();
  const adapterCapabilities = useDebuggerStore.use.adapterCapabilities();
  const pendingRequests = useDebuggerStore.use.pendingRequests();
  const debuggerActions = useDebuggerStore.use.actions();
  const [customCommand, setCustomCommand] = useState("");
  const [launchLoadError, setLaunchLoadError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [enabledExceptionFilters, setEnabledExceptionFilters] = useState<Set<string>>(new Set());
  const [activePanel, setActivePanel] = useState<DebuggerPanel>("stack");
  const syncedBreakpointFilesRef = useRef<Set<string>>(new Set());

  const generatedConfig = useMemo(
    () => createGeneratedDebugConfig(activeFile, rootFolderPath),
    [activeFile, rootFolderPath],
  );

  const allConfigs = useMemo(
    () => [generatedConfig, ...workspaceConfigs, ...userConfigs],
    [generatedConfig, workspaceConfigs, userConfigs],
  );

  const selectedConfig =
    allConfigs.find((config) => config.id === activeConfigId) ?? generatedConfig;
  const activeConfig = activeSession
    ? (allConfigs.find((config) => config.id === activeSession.configId) ?? selectedConfig)
    : selectedConfig;
  const resolvedSelectedConfig = resolveDebugConfigVariables(
    selectedConfig,
    activeFile,
    rootFolderPath,
  );
  const resolvedActiveConfig = resolveDebugConfigVariables(
    activeConfig,
    activeFile,
    rootFolderPath,
  );
  const selectedCommand =
    resolvedSelectedConfig.runtime === "custom" && customCommand.trim()
      ? customCommand.trim()
      : buildDebugCommand({
          ...resolvedSelectedConfig,
          command: resolvedSelectedConfig.command || customCommand,
        });
  const adapterCommandPreview = [
    resolvedSelectedConfig.adapterCommand,
    ...(resolvedSelectedConfig.adapterArgs ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const canStartDebugging =
    resolvedSelectedConfig.runtime === "java"
      ? Boolean(activeFile?.path)
      : resolvedSelectedConfig.adapterCommand
        ? Boolean(resolvedSelectedConfig.adapterCommand.trim())
        : Boolean(selectedCommand.trim());
  const isActiveSession = activeSession?.status === "running" || activeSession?.status === "paused";
  const isAdapterSession = Boolean(
    isActiveSession &&
    (resolvedActiveConfig.adapterCommand || resolvedActiveConfig.runtime === "java"),
  );
  const activeThreadId = stoppedState?.threadId ?? threads[0]?.id;
  const canSendAdapterThreadRequest = Boolean(isAdapterSession && activeThreadId);
  const isPaused = activeSession?.status === "paused";
  const canStep = Boolean(canSendAdapterThreadRequest && isPaused);
  const breakpointSyncSignature = useMemo(
    () =>
      breakpoints
        .map(
          (breakpoint) =>
            `${breakpoint.filePath}:${breakpoint.line}:${breakpoint.enabled}:${breakpoint.condition ?? ""}:${breakpoint.hitCondition ?? ""}:${breakpoint.logMessage ?? ""}`,
        )
        .sort()
        .join("|"),
    [breakpoints],
  );
  const activeAdapterOutput = useMemo(
    () =>
      activeSession
        ? adapterOutput.filter((output) => output.sessionId === activeSession.id).slice(-80)
        : [],
    [activeSession, adapterOutput],
  );
  const sortedBreakpoints = useMemo(
    () =>
      [...breakpoints].sort((a, b) =>
        a.filePath === b.filePath ? a.line - b.line : a.filePath.localeCompare(b.filePath),
      ),
    [breakpoints],
  );
  const exceptionBreakpointFilters = useMemo(
    () => getExceptionBreakpointFilters(adapterCapabilities),
    [adapterCapabilities],
  );

  useEffect(() => {
    debuggerActions.hydrate();
  }, [debuggerActions]);
  useEffect(() => {
    if (!activeSession?.id || !isAdapterSession) {
      syncedBreakpointFilesRef.current = new Set();
      return;
    }

    const filePaths = new Set([
      ...syncedBreakpointFilesRef.current,
      ...breakpoints.map((breakpoint) => breakpoint.filePath),
    ]);
    let isCurrentSync = true;

    syncDebugBreakpoints(activeSession.id, breakpoints, Array.from(filePaths))
      .then(() => {
        if (isCurrentSync) syncedBreakpointFilesRef.current = filePaths;
      })
      .catch((error) => {
        if (isCurrentSync) setStartError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      isCurrentSync = false;
    };
  }, [activeSession?.id, breakpointSyncSignature, breakpoints, isAdapterSession]);

  useEffect(() => {
    if (!rootFolderPath) {
      debuggerActions.setWorkspaceConfigs([]);
      setLaunchLoadError(null);
      return;
    }

    const loadLaunchConfig = async () => {
      setLaunchLoadError(null);
      try {
        const content = await readFileContent(joinPath(rootFolderPath, ".vscode", "launch.json"));
        debuggerActions.setWorkspaceConfigs(parseDebugLaunchJson(content));
      } catch {
        debuggerActions.setWorkspaceConfigs([]);
        setLaunchLoadError("No launch.json found");
      }
    };

    void loadLaunchConfig();
  }, [debuggerActions, rootFolderPath]);

  const startDebugging = async () => {
    setStartError(null);
    if (resolvedSelectedConfig.runtime === "java" && activeFile?.path) {
      try {
        const adapterSession = await startJavaDebugLaunchSession(
          resolvedSelectedConfig,
          breakpoints,
          activeFile.path,
        );
        debuggerActions.startSession({
          id: adapterSession.id,
          name: resolvedSelectedConfig.name,
          configId: resolvedSelectedConfig.id,
          command: adapterSession.command,
          cwd: adapterSession.cwd,
          startedAt: Date.now(),
          status: "running",
        });
        debuggerActions.setAdapterCapabilities(adapterSession.capabilities ?? {});
        setEnabledExceptionFilters(
          new Set(
            getExceptionBreakpointFilters(adapterSession.capabilities ?? {})
              .filter((filter) => filter.default)
              .map((filter) => filter.filter),
          ),
        );
      } catch (error) {
        setStartError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (resolvedSelectedConfig.adapterCommand) {
      try {
        const adapterSession = await startDebugLaunchSession(resolvedSelectedConfig, breakpoints);
        debuggerActions.startSession({
          id: adapterSession.id,
          name: resolvedSelectedConfig.name,
          configId: resolvedSelectedConfig.id,
          command: [adapterSession.command, ...adapterSession.args].join(" "),
          cwd: adapterSession.cwd,
          startedAt: Date.now(),
          status: "running",
        });
        debuggerActions.setAdapterCapabilities(adapterSession.capabilities ?? {});
        setEnabledExceptionFilters(
          new Set(
            getExceptionBreakpointFilters(adapterSession.capabilities ?? {})
              .filter((filter) => filter.default)
              .map((filter) => filter.filter),
          ),
        );
      } catch (error) {
        setStartError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const command = selectedCommand.trim();
    if (!command) return;

    const cwd = resolvedSelectedConfig.cwd || rootFolderPath || undefined;
    window.dispatchEvent(
      new CustomEvent("create-terminal-with-command", {
        detail: {
          name: resolvedSelectedConfig.name,
          command,
          workingDirectory: cwd,
        },
      }),
    );

    debuggerActions.startSession({
      id: `debug_${Date.now()}`,
      name: resolvedSelectedConfig.name,
      configId: resolvedSelectedConfig.id,
      command,
      cwd,
      startedAt: Date.now(),
      status: "running",
    });
  };

  const stopDebugging = async () => {
    if (
      activeSession &&
      (resolvedActiveConfig.adapterCommand || resolvedActiveConfig.runtime === "java")
    ) {
      await disconnectDebugAdapterSession(activeSession.id).catch(() => {});
    } else {
      window.dispatchEvent(new CustomEvent("close-active-terminal"));
    }
    debuggerActions.stopSession();
  };

  const restartDebugging = async () => {
    if (!activeSession || !isActiveSession) {
      await startDebugging();
      return;
    }

    setStartError(null);
    try {
      if (isAdapterSession && adapterCapabilities.supportsRestartRequest === true) {
        await restartDebugAdapterSession(activeSession.id);
        debuggerActions.setSessionStatus("running");
        return;
      }

      await stopDebugging();
      await startDebugging();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    }
  };

  const sendAdapterThreadRequest = async (
    command: "continue" | "pause" | "next" | "stepIn" | "stepOut",
  ) => {
    if (!activeSession?.id || !activeThreadId || !isAdapterSession) return;

    setStartError(null);
    try {
      await sendDebugAdapterRequest(activeSession.id, command, { threadId: activeThreadId });
      if (command !== "pause") debuggerActions.setSessionStatus("running");
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleCurrentLineBreakpoint = () => {
    if (!activeFile) return;
    const cursorLine = useEditorStateStore.getState().cursorPosition.line;
    debuggerActions.toggleBreakpoint(activeFile.path, cursorLine);
  };

  const toggleExceptionBreakpoint = async (filter: string, enabled: boolean) => {
    if (!activeSession?.id || !isAdapterSession) return;

    const nextFilters = new Set(enabledExceptionFilters);
    if (enabled) nextFilters.add(filter);
    else nextFilters.delete(filter);
    setEnabledExceptionFilters(nextFilters);

    try {
      await syncExceptionBreakpoints(activeSession.id, Array.from(nextFilters));
    } catch (error) {
      setEnabledExceptionFilters(enabledExceptionFilters);
      setStartError(error instanceof Error ? error.message : String(error));
    }
  };

  const hotCodeReplace = async () => {
    if (!activeSession?.id || resolvedActiveConfig.runtime !== "java") return;

    setStartError(null);
    try {
      const result = await applyJavaHotCodeReplace(activeSession.id);
      if (result.changedClasses.length === 0) {
        toast.info("No changed Java classes were available to reload.");
      } else {
        toast.success(
          `Reloaded ${result.changedClasses.length} Java class${result.changedClasses.length === 1 ? "" : "es"}.`,
        );
      }
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    }
  };

  const selectStackFrame = async (frameId: number, sourcePath?: string, line?: number) => {
    debuggerActions.selectStackFrame(frameId);

    if (activeSession?.id) {
      try {
        const seq = await sendDebugAdapterRequest(activeSession.id, "scopes", { frameId });
        debuggerActions.registerAdapterRequest(seq, { command: "scopes", frameId });
      } catch {
        // Some adapters may not allow scope requests after the session moves on.
      }
    }

    if (sourcePath && line && line > 0) {
      await handleFileOpen?.(sourcePath, false);
      window.dispatchEvent(
        new CustomEvent("menu-go-to-line", {
          detail: { path: sourcePath, line },
        }),
      );
    }
  };

  useEffect(() => {
    const start = () => void startDebugging();
    const stop = () => void stopDebugging();
    const restart = () => void restartDebugging();
    window.addEventListener("debugger-start", start);
    window.addEventListener("debugger-stop", stop);
    window.addEventListener("debugger-restart", restart);
    return () => {
      window.removeEventListener("debugger-start", start);
      window.removeEventListener("debugger-stop", stop);
      window.removeEventListener("debugger-restart", restart);
    };
  });

  return (
    <Tabs
      value={activePanel}
      onValueChange={(value) => setActivePanel(value as DebuggerPanel)}
      className="h-full min-h-0 gap-0 bg-background text-foreground"
    >
      <ContextMenu>
        <ContextMenuTrigger
          render={<TabBarSurface className="scrollbar-none justify-between overscroll-x-contain" />}
        >
          <Bug className="text-subtle-foreground" weight="duotone" />
          <div className="scrollbar-none min-w-0 flex-1 overflow-x-auto">
            <TabsList variant="bare" aria-label="Debugger panels">
              <TabsTrigger value="stack" className="w-fit flex-none">
                Call Stack
                <Badge variant="muted" className="tabular-nums">
                  {stackFrames.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="variables" className="w-fit flex-none">
                Variables
                <Badge variant="muted" className="tabular-nums">
                  {scopes.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="watch" className="w-fit flex-none">
                Watch
                <Badge variant="muted" className="tabular-nums">
                  {watchExpressions.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="console" className="w-fit flex-none">
                Console
                <Badge variant="muted" className="tabular-nums">
                  {activeAdapterOutput.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="breakpoints" className="w-fit flex-none">
                Breakpoints
                <Badge variant="muted" className="tabular-nums">
                  {sortedBreakpoints.length + enabledExceptionFilters.size}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </div>
          {activeSession ? <DebugStatusBadge status={activeSession.status} /> : null}
          {activePanel === "console" && activeAdapterOutput.length > 0 ? (
            <Button
              variant="ghost"
              tooltip="Clear console"
              onClick={debuggerActions.clearAdapterTranscript}
              iconOnly
            >
              <Trash />
            </Button>
          ) : null}
          {activePanel === "breakpoints" && sortedBreakpoints.length > 0 ? (
            <Button
              variant="ghost"
              tooltip="Clear breakpoints"
              onClick={debuggerActions.clearBreakpoints}
              iconOnly
            >
              <Trash />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            tooltip="Toggle breakpoint at cursor"
            commandId="debug.toggleBreakpoint"
            onClick={toggleCurrentLineBreakpoint}
            disabled={!activeFile}
            iconOnly
          >
            <Circle />
          </Button>
          <Button
            variant="ghost"
            tooltip={isFullScreen ? "Exit full screen Run and Debug" : "Full screen Run and Debug"}
            commandId="workbench.toggleActivePaneFullscreen"
            onClick={onFullScreen}
            aria-label={
              isFullScreen ? "Exit full screen Run and Debug" : "Full screen Run and Debug"
            }
            iconOnly
          >
            {isFullScreen ? <Minimize /> : <Maximize />}
          </Button>
          <Button
            variant="ghost"
            tooltip="Close Run and Debug"
            onClick={onClose}
            aria-label="Close Run and Debug"
            iconOnly
          >
            <X />
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={!canStartDebugging || isActiveSession}
            onClick={() => void startDebugging()}
          >
            <Play />
            Start Debugging
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!canSendAdapterThreadRequest}
            onClick={() => void sendAdapterThreadRequest(isPaused ? "continue" : "pause")}
          >
            {isPaused ? <Play /> : <Pause />}
            {isPaused ? "Continue Debugging" : "Pause Debugging"}
          </ContextMenuItem>
          <ContextMenuItem disabled={!isActiveSession} onClick={() => void stopDebugging()}>
            <Square />
            Stop Debugging
          </ContextMenuItem>
          <ContextMenuItem disabled={!canStartDebugging} onClick={() => void restartDebugging()}>
            <ArrowsClockwise />
            Restart Debugging
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!activeFile} onClick={toggleCurrentLineBreakpoint}>
            <Circle />
            Toggle Breakpoint at Cursor
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onFullScreen}>
            {isFullScreen ? <Minimize /> : <Maximize />}
            {isFullScreen ? "Exit Full Screen" : "Full Screen"}
          </ContextMenuItem>
          <ContextMenuItem onClick={onClose}>
            <X />
            Close Run and Debug
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-border/70 border-r">
          <div className="space-y-3 p-3">
            <div className="space-y-1.5">
              <div className="font-sans text-subtle-foreground ui-text-sm">Configuration</div>
              <Select
                value={selectedConfig.id}
                onChange={(value) => debuggerActions.setActiveConfigId(value)}
                options={allConfigs.map((config) => ({ value: config.id, label: config.name }))}
                variant="default"
                searchable
                aria-label="Debug configuration"
              />
            </div>

            <div className="space-y-1.5">
              <div className="font-sans text-subtle-foreground ui-text-sm">Command</div>
              {resolvedSelectedConfig.runtime === "custom" ? (
                <Input
                  value={customCommand}
                  onChange={(event) => setCustomCommand(event.target.value)}
                  placeholder="Command to run"
                />
              ) : (
                <div className="font-sans min-h-8 truncate rounded-lg border border-border/60 bg-surface/70 px-2 py-1.5 font-mono ui-text-sm text-subtle-foreground">
                  {adapterCommandPreview || selectedCommand || "No command available"}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="accent"
                tooltip="Start debugging"
                onClick={startDebugging}
                disabled={!canStartDebugging || isActiveSession}
                commandId="debug.start"
                iconOnly
              >
                <Play />
              </Button>
              <Button
                variant="default"
                tooltip={isPaused ? "Continue debugging" : "Pause debugging"}
                disabled={!canSendAdapterThreadRequest}
                onClick={() => void sendAdapterThreadRequest(isPaused ? "continue" : "pause")}
                aria-label={isPaused ? "Continue debugging" : "Pause debugging"}
                iconOnly
              >
                {isPaused ? <Play /> : <Pause />}
              </Button>
              <Button
                variant="danger"
                tooltip="Stop debugging"
                disabled={!isActiveSession}
                onClick={() => void stopDebugging()}
                commandId="debug.stop"
                iconOnly
              >
                <Square />
              </Button>
              <Button
                variant="default"
                tooltip="Step over"
                disabled={!canStep}
                onClick={() => void sendAdapterThreadRequest("next")}
                iconOnly
              >
                <ArrowBendDownLeft />
              </Button>
              <Button
                variant="default"
                tooltip="Step into"
                disabled={!canStep}
                onClick={() => void sendAdapterThreadRequest("stepIn")}
                iconOnly
              >
                <ArrowDown />
              </Button>
              <Button
                variant="default"
                tooltip="Step out"
                disabled={!canStep}
                onClick={() => void sendAdapterThreadRequest("stepOut")}
                iconOnly
              >
                <ArrowUp />
              </Button>
              <Button
                variant="default"
                tooltip="Restart debugging"
                disabled={!canStartDebugging}
                onClick={() => void restartDebugging()}
                commandId="debug.restart"
                iconOnly
              >
                <ArrowsClockwise />
              </Button>
              {isAdapterSession && resolvedActiveConfig.runtime === "java" ? (
                <Button
                  variant="default"
                  tooltip="Apply Java changes"
                  onClick={() => void hotCodeReplace()}
                  iconOnly
                >
                  <ArrowsClockwise />
                </Button>
              ) : null}
            </div>

            {startError ? (
              <Alert tone="error">
                <AlertDescription>{startError}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          {activeSession && activeSession.status !== "idle" ? (
            <div className="border-border/70 border-t px-3 py-2 ui-text-sm">
              <div className="flex items-center gap-2">
                <DebugSessionStatusIcon status={activeSession.status} />
                <span className="truncate font-medium">{activeSession.name}</span>
                {stoppedState ? <Badge variant="warning">Paused</Badge> : null}
              </div>
              <div className="mt-1 line-clamp-2 ui-text-sm text-subtle-foreground">
                {stoppedState?.description || stoppedState?.reason || activeSession.command}
              </div>
            </div>
          ) : null}

          <div className="mt-auto border-border/70 border-t px-3 py-2 ui-text-sm text-subtle-foreground">
            <div className="flex items-center gap-1.5">
              <FolderOpen size={12} />
              <span className="truncate">
                {rootFolderPath || launchLoadError || "Open a project to load launch.json"}
              </span>
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col">
          <TabsContent value="stack">
            <ScrollArea className="h-full" orientation="both">
              <DebugStackFrames
                frames={stackFrames}
                selectedFrameId={selectedFrameId}
                onSelect={selectStackFrame}
              />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="variables">
            <ScrollArea className="h-full" orientation="both">
              <DebugVariablesPanel
                activeSessionId={activeSession?.id}
                selectedFrameId={selectedFrameId}
                scopes={scopes}
                variablesByReference={variablesByReference}
                pendingRequests={pendingRequests}
                canSetVariables={adapterCapabilities.supportsSetVariable === true}
              />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="watch">
            <ScrollArea className="h-full" orientation="both">
              <DebugWatchPanel
                activeSessionId={activeSession?.id}
                selectedFrameId={selectedFrameId}
                isPaused={isPaused}
                pendingRequests={pendingRequests}
              />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="console">
            <ScrollArea className="h-full" orientation="both">
              {activeAdapterOutput.length === 0 ? (
                <EmptyState layout="sidebar" message="Adapter output appears here." />
              ) : (
                <div className="py-1">
                  {activeAdapterOutput.map((output, index) => (
                    <div
                      key={`${output.sessionId}-${index}`}
                      className={cn(
                        "whitespace-pre-wrap wrap-break-word px-3 py-1 font-mono ui-text-sm",
                        output.stream === "stderr" ? "text-destructive" : "text-subtle-foreground",
                      )}
                    >
                      {output.data.trimEnd()}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="breakpoints">
            <ScrollArea className="h-full" orientation="both">
              <DebugExceptionBreakpointsList
                filters={exceptionBreakpointFilters}
                enabledFilters={enabledExceptionFilters}
                onToggle={(filter, enabled) =>
                  void toggleExceptionBreakpoint(filter.filter, enabled)
                }
              />
              <DebugBreakpointsList
                breakpoints={sortedBreakpoints}
                onOpen={async (breakpoint) => {
                  await handleFileOpen?.(breakpoint.filePath, false);
                  window.dispatchEvent(
                    new CustomEvent("menu-go-to-line", {
                      detail: { path: breakpoint.filePath, line: breakpoint.line + 1 },
                    }),
                  );
                }}
                onToggle={(breakpoint) =>
                  debuggerActions.setBreakpointEnabled(breakpoint.id, !breakpoint.enabled)
                }
                onUpdateOptions={(breakpoint, options) =>
                  debuggerActions.updateBreakpointOptions(breakpoint.id, options)
                }
                onRemove={(breakpoint) => debuggerActions.removeBreakpoint(breakpoint.id)}
                showEmptyState={exceptionBreakpointFilters.length === 0}
              />
            </ScrollArea>
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
