import {
  sendDebugAdapterRequest,
  subscribeDebuggerEvents,
} from "@/features/debugger/services/debug-adapter-service";
import { useDebuggerStore } from "@/features/debugger/stores/debugger-store";
import type {
  DebugProtocolMessage,
  DebugScope,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
} from "@/features/debugger/types/debugger";

let unsubscribeDebuggerEvents: (() => void) | null = null;
let pendingSubscription: Promise<void> | null = null;

export function initializeDebuggerEventBridge(): Promise<void> {
  if (unsubscribeDebuggerEvents) return Promise.resolve();
  if (pendingSubscription) return pendingSubscription;

  pendingSubscription = subscribeDebuggerEvents({
    onMessage: (message) => {
      useDebuggerStore.getState().actions.recordAdapterMessage(message);
      void handleDebugProtocolMessage(message);
    },
    onOutput: (output) => useDebuggerStore.getState().actions.recordAdapterOutput(output),
    onSessionEnded: (event) => useDebuggerStore.getState().actions.recordSessionEnded(event),
  })
    .then((unlisten) => {
      unsubscribeDebuggerEvents = unlisten;
    })
    .finally(() => {
      pendingSubscription = null;
    });

  return pendingSubscription;
}

export function disposeDebuggerEventBridge() {
  unsubscribeDebuggerEvents?.();
  unsubscribeDebuggerEvents = null;
}

async function handleDebugProtocolMessage(payload: DebugProtocolMessage) {
  const message = asRecord(payload.message);
  if (!message) return;

  if (message.type === "event") {
    await handleDebugEvent(payload.sessionId, message);
    return;
  }

  if (message.type === "response") {
    await handleDebugResponse(payload.sessionId, message);
  }
}

async function handleDebugEvent(sessionId: string, message: Record<string, unknown>) {
  const event = typeof message.event === "string" ? message.event : "";
  const body = asRecord(message.body);
  const actions = useDebuggerStore.getState().actions;

  if (event === "stopped") {
    const threadId = typeof body?.threadId === "number" ? body.threadId : undefined;
    actions.setSessionStatus("paused");
    actions.setStoppedState({
      reason: typeof body?.reason === "string" ? body.reason : "stopped",
      threadId,
      description: typeof body?.description === "string" ? body.description : undefined,
    });

    if (typeof threadId === "number") {
      await requestStackTrace(sessionId, threadId);
    } else {
      await requestThreads(sessionId);
    }
    return;
  }

  if (event === "continued") {
    actions.setSessionStatus("running");
    actions.setStoppedState(null);
    return;
  }

  if (event === "terminated" || event === "exited") {
    actions.recordSessionEnded({
      sessionId,
      reason: event,
    });
  }
}

async function handleDebugResponse(sessionId: string, message: Record<string, unknown>) {
  const requestSeq = typeof message.request_seq === "number" ? message.request_seq : null;
  const command = typeof message.command === "string" ? message.command : "";
  const body = asRecord(message.body);
  const store = useDebuggerStore.getState();
  const context = requestSeq ? store.pendingRequests[requestSeq] : undefined;

  if (requestSeq) {
    store.actions.clearAdapterRequest(requestSeq);
  }

  if (message.success === false) {
    if (context?.command === "evaluate") {
      store.actions.setWatchResult({
        expressionId: context.expressionId,
        value: "",
        variablesReference: 0,
        error:
          typeof message.message === "string" ? message.message : "Could not evaluate expression.",
        evaluatedAt: Date.now(),
      });
    }
    return;
  }

  if (command === "threads") {
    const threads = toThreads(body?.threads);
    store.actions.setThreads(threads);
    const firstThreadId = threads[0]?.id;
    if (typeof firstThreadId === "number") {
      await requestStackTrace(sessionId, firstThreadId);
    }
    return;
  }

  if (command === "stackTrace") {
    const frames = toStackFrames(body?.stackFrames);
    store.actions.setStackFrames(frames);
    const firstFrameId = frames[0]?.id;
    if (typeof firstFrameId === "number") {
      await requestScopes(sessionId, firstFrameId);
    }
    return;
  }

  if (command === "scopes") {
    const scopes = toScopes(body?.scopes);
    store.actions.setScopes(scopes);
    await Promise.all(
      scopes
        .filter((scope) => scope.variablesReference > 0)
        .map((scope) => requestVariables(sessionId, scope.variablesReference)),
    );
    return;
  }

  if (command === "variables" && context?.command === "variables") {
    store.actions.setVariables(context.variablesReference, toVariables(body?.variables));
    return;
  }

  if (command === "evaluate" && context?.command === "evaluate") {
    store.actions.setWatchResult({
      expressionId: context.expressionId,
      value: typeof body?.result === "string" ? body.result : "",
      type: typeof body?.type === "string" ? body.type : undefined,
      variablesReference:
        typeof body?.variablesReference === "number" ? body.variablesReference : 0,
      evaluatedAt: Date.now(),
    });
  }
}

async function requestThreads(sessionId: string) {
  const seq = await sendDebugAdapterRequest(sessionId, "threads");
  useDebuggerStore.getState().actions.registerAdapterRequest(seq, { command: "threads" });
}

async function requestStackTrace(sessionId: string, threadId: number) {
  const seq = await sendDebugAdapterRequest(sessionId, "stackTrace", {
    threadId,
    startFrame: 0,
    levels: 50,
  });
  useDebuggerStore.getState().actions.registerAdapterRequest(seq, {
    command: "stackTrace",
    threadId,
  });
}

async function requestScopes(sessionId: string, frameId: number) {
  const seq = await sendDebugAdapterRequest(sessionId, "scopes", { frameId });
  useDebuggerStore.getState().actions.registerAdapterRequest(seq, { command: "scopes", frameId });
}

async function requestVariables(sessionId: string, variablesReference: number) {
  const seq = await sendDebugAdapterRequest(sessionId, "variables", { variablesReference });
  useDebuggerStore.getState().actions.registerAdapterRequest(seq, {
    command: "variables",
    variablesReference,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toThreads(value: unknown): DebugThread[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): DebugThread | null => {
      const thread = asRecord(item);
      if (!thread || typeof thread.id !== "number") return null;
      return {
        id: thread.id,
        name: typeof thread.name === "string" ? thread.name : `Thread ${thread.id}`,
      };
    })
    .filter((thread): thread is DebugThread => Boolean(thread));
}

function toStackFrames(value: unknown): DebugStackFrame[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): DebugStackFrame | null => {
      const frame = asRecord(item);
      if (!frame || typeof frame.id !== "number") return null;
      const source = asRecord(frame.source);
      return {
        id: frame.id,
        name: typeof frame.name === "string" ? frame.name : `Frame ${frame.id}`,
        sourcePath: typeof source?.path === "string" ? source.path : undefined,
        line: typeof frame.line === "number" ? frame.line : 0,
        column: typeof frame.column === "number" ? frame.column : 0,
      };
    })
    .filter((frame): frame is DebugStackFrame => Boolean(frame));
}

function toScopes(value: unknown): DebugScope[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): DebugScope | null => {
      const scope = asRecord(item);
      if (!scope || typeof scope.variablesReference !== "number") return null;
      return {
        name: typeof scope.name === "string" ? scope.name : "Scope",
        variablesReference: scope.variablesReference,
        expensive: typeof scope.expensive === "boolean" ? scope.expensive : undefined,
      };
    })
    .filter((scope): scope is DebugScope => Boolean(scope));
}

function toVariables(value: unknown): DebugVariable[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): DebugVariable | null => {
      const variable = asRecord(item);
      if (!variable || typeof variable.name !== "string") return null;
      return {
        name: variable.name,
        value: typeof variable.value === "string" ? variable.value : "",
        type: typeof variable.type === "string" ? variable.type : undefined,
        variablesReference:
          typeof variable.variablesReference === "number" ? variable.variablesReference : 0,
      };
    })
    .filter((variable): variable is DebugVariable => Boolean(variable));
}
