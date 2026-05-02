import { Bug, FolderOpen, ListBullets, Pause, Play, Square, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useProjectStore } from "@/features/window/stores/project-store";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import { joinPath } from "@/utils/path-helpers";
import {
  sendDebugAdapterRequest,
  startDebugLaunchSession,
  stopDebugAdapterSession,
  syncDebugBreakpoints,
} from "../services/debug-adapter-service";
import { useDebuggerStore } from "../stores/debugger-store";
import {
  buildDebugCommand,
  createGeneratedDebugConfig,
  parseDebugLaunchJson,
  resolveDebugConfigVariables,
} from "../utils/debugger-command";
import {
  DebugBreakpointsList,
  DebugEmptyState,
  DebugSection,
  DebugSessionStatusIcon,
  DebugStackFrames,
} from "./debugger-panels";
import { DebugWatchPanel } from "./debugger-watch-panel";
import { DebugVariablesPanel } from "./debugger-variables-panel";

const getActiveDebuggableFile = () => {
  const bufferStore = useBufferStore.getState();
  const activeBuffer = bufferStore.buffers.find(
    (buffer) => buffer.id === bufferStore.activeBufferId,
  );
  if (!activeBuffer || activeBuffer.type !== "editor" || activeBuffer.isVirtual) return null;

  return {
    path: activeBuffer.path,
    name: activeBuffer.name,
    language: activeBuffer.language,
  };
};

export default function DebuggerView() {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const activeBufferId = useBufferStore.use.activeBufferId();
  const buffers = useBufferStore.use.buffers();
  const cursorPosition = useEditorStateStore.use.cursorPosition();
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
  const pendingRequests = useDebuggerStore.use.pendingRequests();
  const debuggerActions = useDebuggerStore.use.actions();
  const [customCommand, setCustomCommand] = useState("");
  const [launchLoadError, setLaunchLoadError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const syncedBreakpointFilesRef = useRef<Set<string>>(new Set());

  const activeFile = useMemo(() => getActiveDebuggableFile(), [activeBufferId, buffers]);
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
  const canStartDebugging = resolvedSelectedConfig.adapterCommand
    ? Boolean(resolvedSelectedConfig.adapterCommand.trim())
    : Boolean(selectedCommand.trim());
  const isActiveSession = activeSession?.status === "running" || activeSession?.status === "paused";
  const isAdapterSession = Boolean(isActiveSession && resolvedActiveConfig.adapterCommand);
  const activeThreadId = stoppedState?.threadId ?? threads[0]?.id;
  const canSendAdapterThreadRequest = Boolean(isAdapterSession && activeThreadId);
  const isPaused = activeSession?.status === "paused";
  const canStep = Boolean(canSendAdapterThreadRequest && isPaused);
  const breakpointSyncSignature = useMemo(
    () =>
      breakpoints
        .map((breakpoint) => `${breakpoint.filePath}:${breakpoint.line}:${breakpoint.enabled}`)
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

  const stopDebugging = () => {
    if (activeSession && resolvedActiveConfig.adapterCommand) {
      void stopDebugAdapterSession(activeSession.id).catch(() => {});
    } else {
      window.dispatchEvent(new CustomEvent("close-active-terminal"));
    }
    debuggerActions.stopSession();
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
    const file = getActiveDebuggableFile();
    if (!file) return;
    debuggerActions.toggleBreakpoint(file.path, cursorPosition.line);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg text-text">
      <div className="flex h-10 shrink-0 items-center gap-2 border-border/70 border-b px-3">
        <Bug size={16} className="text-text-lighter" weight="duotone" />
        <div className="min-w-0 flex-1 font-medium text-sm">Debug</div>
        <Button
          size="icon-sm"
          variant="ghost"
          tooltip="Toggle breakpoint on current line"
          onClick={toggleCurrentLineBreakpoint}
          disabled={!activeFile}
        >
          <ListBullets />
        </Button>
      </div>

      <div className="space-y-2 border-border/70 border-b p-2.5">
        <Select
          value={selectedConfig.id}
          onChange={(value) => debuggerActions.setActiveConfigId(value)}
          options={allConfigs.map((config) => ({ value: config.id, label: config.name }))}
          size="sm"
          aria-label="Debug configuration"
        />

        {resolvedSelectedConfig.runtime === "custom" ? (
          <Input
            value={customCommand}
            onChange={(event) => setCustomCommand(event.target.value)}
            placeholder="Command to run"
            size="sm"
          />
        ) : (
          <div className="truncate rounded-md border border-border/60 bg-secondary-bg px-2 py-1.5 font-mono text-[11px] text-text-lighter">
            {adapterCommandPreview || selectedCommand || "No command available"}
          </div>
        )}

        <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
          <Button
            size="sm"
            variant="primary"
            onClick={startDebugging}
            disabled={!canStartDebugging || isActiveSession}
            commandId="debug.start"
          >
            <Play />
            Start
          </Button>
          <Button
            size="icon-sm"
            variant="secondary"
            tooltip={isPaused ? "Continue" : "Pause"}
            disabled={!canSendAdapterThreadRequest}
            onClick={() => void sendAdapterThreadRequest(isPaused ? "continue" : "pause")}
            aria-label={isPaused ? "Continue debugging" : "Pause debugging"}
          >
            {isPaused ? <Play /> : <Pause />}
          </Button>
          <Button
            size="icon-sm"
            variant="danger"
            tooltip="Stop"
            disabled={!isActiveSession}
            onClick={stopDebugging}
            commandId="debug.stop"
          >
            <Square />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <Button
            size="xs"
            variant="secondary"
            tooltip="Step over"
            disabled={!canStep}
            onClick={() => void sendAdapterThreadRequest("next")}
          >
            Over
          </Button>
          <Button
            size="xs"
            variant="secondary"
            tooltip="Step into"
            disabled={!canStep}
            onClick={() => void sendAdapterThreadRequest("stepIn")}
          >
            Into
          </Button>
          <Button
            size="xs"
            variant="secondary"
            tooltip="Step out"
            disabled={!canStep}
            onClick={() => void sendAdapterThreadRequest("stepOut")}
          >
            Out
          </Button>
        </div>

        {startError ? <div className="text-[11px] text-error">{startError}</div> : null}
      </div>

      {activeSession && activeSession.status !== "idle" ? (
        <div className="border-border/70 border-b px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <DebugSessionStatusIcon status={activeSession.status} />
            <span className="truncate font-medium">{activeSession.name}</span>
            {stoppedState ? (
              <span className="shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                Paused
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-[11px] text-text-lighter">
            {stoppedState?.description || stoppedState?.reason || activeSession.command}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <DebugSection title="Stack" count={stackFrames.length}>
          <DebugStackFrames
            frames={stackFrames}
            selectedFrameId={selectedFrameId}
            onSelect={selectStackFrame}
          />
        </DebugSection>

        <DebugSection title="Watch" count={watchExpressions.length}>
          <DebugWatchPanel
            activeSessionId={activeSession?.id}
            selectedFrameId={selectedFrameId}
            isPaused={isPaused}
            pendingRequests={pendingRequests}
          />
        </DebugSection>

        <DebugSection title="Variables" count={scopes.length}>
          <DebugVariablesPanel
            activeSessionId={activeSession?.id}
            selectedFrameId={selectedFrameId}
            scopes={scopes}
            variablesByReference={variablesByReference}
            pendingRequests={pendingRequests}
          />
        </DebugSection>

        <DebugSection
          title="Console"
          count={activeAdapterOutput.length}
          defaultOpen={false}
          action={
            activeAdapterOutput.length > 0 ? (
              <Button
                size="icon-xs"
                variant="ghost"
                tooltip="Clear console"
                onClick={(event) => {
                  event.stopPropagation();
                  debuggerActions.clearAdapterTranscript();
                }}
              >
                <Trash />
              </Button>
            ) : null
          }
        >
          {activeAdapterOutput.length === 0 ? (
            <DebugEmptyState>Adapter output appears here.</DebugEmptyState>
          ) : (
            <div className="py-1">
              {activeAdapterOutput.map((output, index) => (
                <div
                  key={`${output.sessionId}-${index}`}
                  className={cn(
                    "whitespace-pre-wrap break-words px-3 py-1 font-mono text-[11px]",
                    output.stream === "stderr" ? "text-error" : "text-text-lighter",
                  )}
                >
                  {output.data.trimEnd()}
                </div>
              ))}
            </div>
          )}
        </DebugSection>

        <DebugSection
          title="Breakpoints"
          count={sortedBreakpoints.length}
          action={
            sortedBreakpoints.length > 0 ? (
              <Button
                size="icon-xs"
                variant="ghost"
                tooltip="Clear breakpoints"
                onClick={(event) => {
                  event.stopPropagation();
                  debuggerActions.clearBreakpoints();
                }}
              >
                <Trash />
              </Button>
            ) : null
          }
        >
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
            onRemove={(breakpoint) => debuggerActions.removeBreakpoint(breakpoint.id)}
          />
        </DebugSection>
      </div>

      <div className="shrink-0 border-border/70 border-t px-3 py-2 text-[11px] text-text-lighter">
        <div className="flex items-center gap-1.5">
          <FolderOpen size={12} />
          <span className="truncate">
            {rootFolderPath || launchLoadError || "Open a project to load launch.json"}
          </span>
        </div>
      </div>
    </div>
  );
}
