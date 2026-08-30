import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DebugAdapterLaunch,
  DebugAdapterSessionInfo,
  DebugBreakpoint,
  DebugExceptionBreakpointFilter,
  DebugLaunchConfig,
  DebugProcessOutput,
  DebugProtocolMessage,
  DebugSessionEnded,
  DebugVariable,
} from "@/features/debugger/types/debugger.types";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { fileUriFromPath } from "@/features/editor/lsp/workspace-edit";
import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";

interface DebuggerEventHandlers {
  onMessage?: (payload: DebugProtocolMessage) => void;
  onOutput?: (payload: DebugProcessOutput) => void;
  onSessionEnded?: (payload: DebugSessionEnded) => void;
}

interface DebugProtocolWaiter {
  promise: Promise<Record<string, unknown>>;
  cancel: () => void;
}

async function startDebugAdapterSession(
  launch: DebugAdapterLaunch,
): Promise<DebugAdapterSessionInfo> {
  return await invoke<DebugAdapterSessionInfo>("debug_start_session", { launch });
}

export async function sendDebugAdapterRequest(
  sessionId: string,
  command: string,
  argumentsPayload?: unknown,
): Promise<number> {
  return await invoke<number>("debug_send_request", {
    sessionId,
    command,
    arguments: argumentsPayload,
  });
}

export async function sendDebugAdapterResponse(
  sessionId: string,
  requestSeq: number,
  command: string,
  success: boolean,
  body?: unknown,
  message?: string,
): Promise<void> {
  await invoke("debug_send_raw_message", {
    sessionId,
    message: withoutUndefinedValues({
      type: "response",
      request_seq: requestSeq,
      command,
      success,
      body,
      message,
    }),
  });
}

export async function stopDebugAdapterSession(sessionId: string): Promise<void> {
  await invoke("debug_stop_session", { sessionId });
}

export async function disconnectDebugAdapterSession(
  sessionId: string,
  terminateDebuggee = true,
): Promise<void> {
  try {
    await sendDebugAdapterRequestAndWait(
      sessionId,
      "disconnect",
      {
        restart: false,
        terminateDebuggee,
      },
      2_000,
    );
  } finally {
    await stopDebugAdapterSession(sessionId).catch(() => {});
  }
}

export async function restartDebugAdapterSession(sessionId: string): Promise<void> {
  await sendDebugAdapterRequestAndWait(sessionId, "restart");
}

export async function setDebugVariable(
  sessionId: string,
  variablesReference: number,
  name: string,
  value: string,
): Promise<DebugVariable> {
  const response = await sendDebugAdapterRequestAndWait(sessionId, "setVariable", {
    variablesReference,
    name,
    value,
  });
  const body = asRecord(response.body);
  return {
    name,
    value: typeof body?.value === "string" ? body.value : value,
    type: typeof body?.type === "string" ? body.type : undefined,
    variablesReference: typeof body?.variablesReference === "number" ? body.variablesReference : 0,
  };
}

export async function startDebugLaunchSession(
  config: DebugLaunchConfig,
  breakpoints: DebugBreakpoint[],
): Promise<DebugAdapterSessionInfo> {
  if (!config.adapterCommand) {
    throw new Error("Debug configuration is missing adapterCommand");
  }

  const session = await startDebugAdapterSession({
    command: config.adapterCommand,
    args: config.adapterArgs ?? [],
    cwd: config.cwd,
    env: config.env,
  });

  return await configureDebugAdapterSession(session, config, breakpoints);
}

export async function startJavaDebugLaunchSession(
  config: DebugLaunchConfig,
  breakpoints: DebugBreakpoint[],
  filePath: string,
): Promise<DebugAdapterSessionInfo> {
  const lspClient = LspClient.getInstance();
  const resolvedConfig = await resolveJavaLaunchConfiguration(lspClient, config, filePath);
  const portResult = await lspClient.executeCommand(filePath, "vscode.java.startDebugSession");
  const port = typeof portResult === "number" ? portResult : Number(portResult);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Java language server did not return a valid debug adapter port");
  }

  const session = await startDebugAdapterSession({
    host: "127.0.0.1",
    port,
    cwd: resolvedConfig.cwd,
  });

  return await configureDebugAdapterSession(session, resolvedConfig, breakpoints);
}

async function resolveJavaLaunchConfiguration(
  lspClient: LspClient,
  config: DebugLaunchConfig,
  filePath: string,
): Promise<DebugLaunchConfig> {
  if ((config.request ?? "launch") === "attach") return config;

  const adapterConfiguration = { ...config.adapterConfiguration };
  let mainClass = asNonEmptyString(adapterConfiguration.mainClass);
  let projectName = asNonEmptyString(adapterConfiguration.projectName);

  if (!mainClass || mainClass === "${file}" || mainClass === filePath) {
    const candidates = await lspClient.executeCommand(filePath, "vscode.java.resolveMainMethod", [
      fileUriFromPath(filePath),
    ]);
    const mainMethods = Array.isArray(candidates) ? candidates.map(asRecord).filter(Boolean) : [];
    const selected = mainMethods[0];
    mainClass = asNonEmptyString(selected?.mainClass);
    projectName = asNonEmptyString(selected?.projectName) ?? projectName;
  }

  if (!mainClass) {
    throw new Error("No Java main method was found in the active file");
  }

  adapterConfiguration.mainClass = mainClass;
  if (projectName) adapterConfiguration.projectName = projectName;

  if (!Array.isArray(adapterConfiguration.classPaths) || !adapterConfiguration.classPaths.length) {
    const classpathResult = await lspClient.executeCommand(
      filePath,
      "vscode.java.resolveClasspath",
      [mainClass, projectName],
    );
    if (Array.isArray(classpathResult)) {
      const [modulePaths, classPaths] = classpathResult;
      if (Array.isArray(modulePaths)) adapterConfiguration.modulePaths = modulePaths;
      if (Array.isArray(classPaths)) adapterConfiguration.classPaths = classPaths;
    }
  }

  if (!asNonEmptyString(adapterConfiguration.javaExec)) {
    const javaExec = await lspClient.executeCommand(filePath, "vscode.java.resolveJavaExecutable", [
      mainClass,
      projectName,
    ]);
    if (typeof javaExec === "string" && javaExec.trim()) {
      adapterConfiguration.javaExec = javaExec;
    }
  }

  return { ...config, adapterConfiguration };
}

async function configureDebugAdapterSession(
  session: DebugAdapterSessionInfo,
  config: DebugLaunchConfig,
  breakpoints: DebugBreakpoint[],
): Promise<DebugAdapterSessionInfo> {
  let initializedWaiter: DebugProtocolWaiter | null = null;

  try {
    initializedWaiter = await createDebugProtocolWaiter(
      session.id,
      (message) => message.type === "event" && message.event === "initialized",
    );

    const initializeResponse = await sendDebugAdapterRequestAndWait(session.id, "initialize", {
      adapterID: config.type ?? config.runtime,
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: true,
    });
    const capabilities = asRecord(initializeResponse.body) ?? {};
    useDebuggerStore.getState().actions.setAdapterCapabilities(capabilities);

    await sendDebugAdapterRequest(
      session.id,
      config.request ?? "launch",
      buildDebugAdapterRequestArguments(config),
    );

    await initializedWaiter.promise;
    await syncDebugBreakpoints(session.id, breakpoints);
    const exceptionBreakpointFilters = getExceptionBreakpointFilters(capabilities);
    if (exceptionBreakpointFilters.length > 0) {
      await syncExceptionBreakpoints(
        session.id,
        exceptionBreakpointFilters
          .filter((filter) => filter.default)
          .map((filter) => filter.filter),
      );
    }
    await sendDebugAdapterRequest(session.id, "configurationDone");

    return { ...session, capabilities };
  } catch (error) {
    initializedWaiter?.cancel();
    await stopDebugAdapterSession(session.id).catch(() => {});
    throw error;
  }
}

export function getExceptionBreakpointFilters(
  capabilities: Record<string, unknown>,
): DebugExceptionBreakpointFilter[] {
  const filters = capabilities.exceptionBreakpointFilters;
  if (!Array.isArray(filters)) return [];

  return filters
    .map((value): DebugExceptionBreakpointFilter | null => {
      const filter = asRecord(value);
      if (typeof filter?.filter !== "string" || typeof filter.label !== "string") return null;
      return {
        filter: filter.filter,
        label: filter.label,
        description: typeof filter.description === "string" ? filter.description : undefined,
        default: filter.default === true,
        supportsCondition: filter.supportsCondition === true,
        conditionDescription:
          typeof filter.conditionDescription === "string" ? filter.conditionDescription : undefined,
      };
    })
    .filter((filter): filter is DebugExceptionBreakpointFilter => Boolean(filter));
}

export async function syncExceptionBreakpoints(
  sessionId: string,
  filters: string[],
): Promise<void> {
  await sendDebugAdapterRequest(sessionId, "setExceptionBreakpoints", { filters });
}

export async function applyJavaHotCodeReplace(
  sessionId: string,
): Promise<{ changedClasses: string[] }> {
  const response = await sendDebugAdapterRequestAndWait(sessionId, "redefineClasses");
  const body = asRecord(response.body);
  return {
    changedClasses: Array.isArray(body?.changedClasses)
      ? body.changedClasses.filter((value): value is string => typeof value === "string")
      : [],
  };
}

export function buildDebugAdapterRequestArguments(
  config: DebugLaunchConfig,
): Record<string, unknown> {
  return withoutUndefinedValues({
    ...config.adapterConfiguration,
    name: config.name,
    type: config.type ?? config.runtime,
    request: config.request ?? "launch",
    ...(config.program !== undefined ? { program: config.program } : {}),
    ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
    ...(config.args !== undefined ? { args: config.args } : {}),
    ...(config.env !== undefined ? { env: config.env } : {}),
  });
}

export async function syncDebugBreakpoints(
  sessionId: string,
  breakpoints: DebugBreakpoint[],
  knownFilePaths: string[] = [],
) {
  const breakpointsByFile = new Map<string, DebugBreakpoint[]>();
  const filePaths = new Set(knownFilePaths);

  for (const breakpoint of breakpoints) {
    filePaths.add(breakpoint.filePath);
    if (!breakpoint.enabled) continue;
    const fileBreakpoints = breakpointsByFile.get(breakpoint.filePath) ?? [];
    fileBreakpoints.push(breakpoint);
    breakpointsByFile.set(breakpoint.filePath, fileBreakpoints);
  }

  await Promise.all(
    Array.from(filePaths, async (filePath) => {
      const fileBreakpoints = breakpointsByFile.get(filePath) ?? [];
      const seq = await sendDebugAdapterRequest(sessionId, "setBreakpoints", {
        source: { path: filePath },
        breakpoints: fileBreakpoints.map((breakpoint) => ({
          line: breakpoint.line + 1,
          condition: breakpoint.condition,
          hitCondition: breakpoint.hitCondition,
          logMessage: breakpoint.logMessage,
        })),
      });
      useDebuggerStore.getState().actions.registerAdapterRequest(seq, {
        command: "setBreakpoints",
        filePath,
        breakpointIds: fileBreakpoints.map((breakpoint) => breakpoint.id),
      });
    }),
  );
}

async function sendDebugAdapterRequestAndWait(
  sessionId: string,
  command: string,
  argumentsPayload?: unknown,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const waiter = await createDebugProtocolWaiter(
    sessionId,
    (message) => message.type === "response" && message.command === command,
    timeoutMs,
  );

  try {
    await sendDebugAdapterRequest(sessionId, command, argumentsPayload);
    const response = await waiter.promise;
    if (response.success === false) {
      throw new Error(
        typeof response.message === "string"
          ? response.message
          : `Debug adapter rejected ${command}`,
      );
    }
    return response;
  } catch (error) {
    waiter.cancel();
    throw error;
  }
}

async function createDebugProtocolWaiter(
  sessionId: string,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 10_000,
): Promise<DebugProtocolWaiter> {
  let settle: ((message: Record<string, unknown>) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;
  let unlisten: UnlistenFn | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timeout) clearTimeout(timeout);
    timeout = null;
    unlisten?.();
    unlisten = null;
  };

  const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  unlisten = await listen<DebugProtocolMessage>("debugger_message", (event) => {
    if (event.payload.sessionId !== sessionId) return;
    const message = asRecord(event.payload.message);
    if (!message || !predicate(message)) return;

    cleanup();
    settle?.(message);
  });

  timeout = setTimeout(() => {
    cleanup();
    fail?.(new Error("Timed out waiting for the debug adapter"));
  }, timeoutMs);

  return {
    promise,
    cancel: cleanup,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function withoutUndefinedValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export async function subscribeDebuggerEvents(
  handlers: DebuggerEventHandlers,
): Promise<UnlistenFn> {
  const unlistenFns = await Promise.all([
    listen<DebugProtocolMessage>("debugger_message", (event) => {
      handlers.onMessage?.(event.payload);
    }),
    listen<DebugProcessOutput>("debugger_output", (event) => {
      handlers.onOutput?.(event.payload);
    }),
    listen<DebugSessionEnded>("debugger_session_ended", (event) => {
      handlers.onSessionEnded?.(event.payload);
    }),
  ]);

  return () => {
    for (const unlisten of unlistenFns) {
      unlisten();
    }
  };
}
