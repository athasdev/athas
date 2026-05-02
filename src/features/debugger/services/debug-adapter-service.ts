import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DebugAdapterLaunch,
  DebugAdapterSessionInfo,
  DebugBreakpoint,
  DebugLaunchConfig,
  DebugProcessOutput,
  DebugProtocolMessage,
  DebugSessionEnded,
} from "@/features/debugger/types/debugger";

interface DebuggerEventHandlers {
  onMessage?: (payload: DebugProtocolMessage) => void;
  onOutput?: (payload: DebugProcessOutput) => void;
  onSessionEnded?: (payload: DebugSessionEnded) => void;
}

export async function startDebugAdapterSession(
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

export async function sendDebugAdapterRawMessage(
  sessionId: string,
  message: unknown,
): Promise<void> {
  await invoke("debug_send_raw_message", { sessionId, message });
}

export async function stopDebugAdapterSession(sessionId: string): Promise<void> {
  await invoke("debug_stop_session", { sessionId });
}

export async function listDebugAdapterSessions(): Promise<DebugAdapterSessionInfo[]> {
  return await invoke<DebugAdapterSessionInfo[]>("debug_list_sessions");
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

  await sendDebugAdapterRequest(session.id, "initialize", {
    adapterID: config.type ?? config.runtime,
    pathFormat: "path",
    linesStartAt1: true,
    columnsStartAt1: true,
    supportsVariableType: true,
    supportsVariablePaging: true,
    supportsRunInTerminalRequest: true,
  });

  await syncDebugBreakpoints(session.id, breakpoints);

  await sendDebugAdapterRequest(session.id, config.request ?? "launch", {
    name: config.name,
    type: config.type ?? config.runtime,
    request: config.request ?? "launch",
    program: config.program,
    cwd: config.cwd,
    args: config.args ?? [],
    env: config.env ?? {},
  });

  await sendDebugAdapterRequest(session.id, "configurationDone");

  return session;
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

  for (const filePath of filePaths) {
    const fileBreakpoints = breakpointsByFile.get(filePath) ?? [];
    await sendDebugAdapterRequest(sessionId, "setBreakpoints", {
      source: { path: filePath },
      breakpoints: fileBreakpoints.map((breakpoint) => ({
        line: breakpoint.line + 1,
      })),
    });
  }
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
