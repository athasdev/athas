import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { DebugSession, DebugProtocolMessage } from "../types/debugger.types";
const mocks = vi.hoisted(() => ({ send: vi.fn(async () => 10), subscribe: vi.fn() }));
vi.mock("../services/debug-adapter-service", () => ({
  sendDebugAdapterRequest: mocks.send,
  sendDebugAdapterResponse: vi.fn(),
  subscribeDebuggerEvents: mocks.subscribe,
}));
import { initializeDebuggerEventBridge } from "../services/debug-adapter-events";
import { useDebuggerStore } from "../stores/debugger.store";
let onMessage: (message: DebugProtocolMessage) => void;
const session: DebugSession = {
  id: "new",
  name: "New",
  configId: "node",
  command: "node",
  startedAt: 1,
  status: "paused",
};
beforeAll(async () => {
  mocks.subscribe.mockImplementation(async (handlers) => {
    onMessage = handlers.onMessage;
    return () => {};
  });
  await initializeDebuggerEventBridge();
});
beforeEach(() => {
  vi.clearAllMocks();
  useDebuggerStore.getState().actions.startSession(session);
  useDebuggerStore.setState({ watchExpressions: [{ id: "watch", expression: "x", createdAt: 1 }] });
});
describe("debugger session isolation", () => {
  it("ignores old responses without consuming a new session's matching request number", () => {
    const actions = useDebuggerStore.getState().actions;
    actions.registerAdapterRequest("new", 42, { command: "evaluate", expressionId: "watch" });
    onMessage({
      sessionId: "old",
      message: {
        type: "response",
        request_seq: 42,
        command: "evaluate",
        success: true,
        body: { result: "old value" },
      },
    });
    expect(useDebuggerStore.getState().pendingRequests[42]).toBeDefined();
    expect(useDebuggerStore.getState().watchResults).toEqual({});
    onMessage({
      sessionId: "new",
      message: {
        type: "response",
        request_seq: 42,
        command: "evaluate",
        success: true,
        body: { result: "new value" },
      },
    });
    expect(useDebuggerStore.getState().pendingRequests[42]).toBeUndefined();
    expect(useDebuggerStore.getState().watchResults.watch.value).toBe("new value");
  });
  it("ignores results from an older refresh or a previously selected frame", () => {
    const actions = useDebuggerStore.getState().actions;
    actions.selectStackFrame(2);
    actions.registerAdapterRequest("new", 41, {
      command: "evaluate",
      expressionId: "watch",
      frameId: 1,
    });
    actions.registerAdapterRequest("new", 42, {
      command: "evaluate",
      expressionId: "watch",
      frameId: 2,
    });
    for (const seq of [41, 42])
      onMessage({
        sessionId: "new",
        message: {
          type: "response",
          request_seq: seq,
          command: "evaluate",
          success: true,
          body: { result: String(seq) },
        },
      });
    expect(useDebuggerStore.getState().watchResults.watch.value).toBe("42");
    actions.registerAdapterRequest("new", 43, {
      command: "evaluate",
      expressionId: "watch",
      frameId: 2,
    });
    actions.selectStackFrame(3);
    onMessage({
      sessionId: "new",
      message: {
        type: "response",
        request_seq: 43,
        command: "evaluate",
        success: false,
        message: "Old frame",
      },
    });
    expect(useDebuggerStore.getState().watchResults.watch.value).toBe("42");
  });

  it("does not overwrite a completed refresh with its older response", () => {
    const actions = useDebuggerStore.getState().actions;
    actions.registerAdapterRequest("new", 41, { command: "evaluate", expressionId: "watch" });
    actions.registerAdapterRequest("new", 42, { command: "evaluate", expressionId: "watch" });
    for (const seq of [42, 41])
      onMessage({
        sessionId: "new",
        message: {
          type: "response",
          request_seq: seq,
          command: "evaluate",
          success: true,
          body: { result: String(seq) },
        },
      });
    expect(useDebuggerStore.getState().watchResults.watch.value).toBe("42");
  });

  it("ignores scopes and variables from a frame the user left", () => {
    const actions = useDebuggerStore.getState().actions;
    actions.selectStackFrame(1);
    actions.registerAdapterRequest("new", 41, { command: "scopes", frameId: 1 });
    actions.registerAdapterRequest("new", 42, { command: "variables", variablesReference: 5 });
    actions.selectStackFrame(2);
    onMessage({
      sessionId: "new",
      message: {
        type: "response",
        request_seq: 41,
        command: "scopes",
        success: true,
        body: { scopes: [{ name: "Old", variablesReference: 5 }] },
      },
    });
    onMessage({
      sessionId: "new",
      message: {
        type: "response",
        request_seq: 42,
        command: "variables",
        success: true,
        body: { variables: [{ name: "old", value: "5" }] },
      },
    });
    expect(useDebuggerStore.getState().scopes).toEqual([]);
    expect(useDebuggerStore.getState().variablesByReference).toEqual({});
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("discards stack requests when execution continues", () => {
    const actions = useDebuggerStore.getState().actions;
    actions.registerAdapterRequest("new", 41, { command: "stackTrace", threadId: 1 });
    onMessage({ sessionId: "new", message: { type: "event", event: "continued" } });
    onMessage({
      sessionId: "new",
      message: {
        type: "response",
        request_seq: 41,
        command: "stackTrace",
        success: true,
        body: { stackFrames: [{ id: 1, name: "old" }] },
      },
    });
    expect(useDebuggerStore.getState().stackFrames).toEqual([]);
    expect(useDebuggerStore.getState().selectedFrameId).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects delayed request registration from an earlier pause, even with reused frame IDs", () => {
    const actions = useDebuggerStore.getState().actions;
    actions.selectStackFrame(1);
    const inspectionRevision = useDebuggerStore.getState().inspectionRevision;
    actions.setStoppedState(null);
    actions.setStoppedState({ reason: "breakpoint", threadId: 1 });
    actions.selectStackFrame(1);
    actions.registerAdapterRequest("new", 41, {
      command: "evaluate",
      expressionId: "watch",
      frameId: 1,
      inspectionRevision,
    });
    expect(useDebuggerStore.getState().pendingRequests[41]).toBeUndefined();
  });

  it("ignores an older send receipt after the newest request has completed", () => {
    const actions = useDebuggerStore.getState().actions;
    actions.registerAdapterRequest("new", 42, { command: "evaluate", expressionId: "watch" });
    onMessage({
      sessionId: "new",
      message: {
        type: "response",
        request_seq: 42,
        command: "evaluate",
        success: true,
        body: { result: "newest" },
      },
    });
    actions.registerAdapterRequest("new", 41, { command: "evaluate", expressionId: "watch" });
    onMessage({
      sessionId: "new",
      message: {
        type: "response",
        request_seq: 41,
        command: "evaluate",
        success: true,
        body: { result: "old" },
      },
    });
    expect(useDebuggerStore.getState().watchResults.watch.value).toBe("newest");
    expect(useDebuggerStore.getState().pendingRequests).toEqual({});
  });

  it("does not change the new session's state for old continuation or stop events", () => {
    onMessage({ sessionId: "old", message: { type: "event", event: "continued" } });
    onMessage({
      sessionId: "old",
      message: { type: "event", event: "stopped", body: { threadId: 1 } },
    });
    expect(useDebuggerStore.getState().activeSession?.status).toBe("paused");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("preserves current watch results and requests when an old process exits", () => {
    const actions = useDebuggerStore.getState().actions;
    actions.setWatchResult({
      expressionId: "watch",
      value: "3",
      variablesReference: 0,
      evaluatedAt: 1,
    });
    actions.registerAdapterRequest("new", 42, { command: "threads" });
    actions.recordSessionEnded({ sessionId: "old", reason: "exited" });
    expect(useDebuggerStore.getState().watchResults.watch.value).toBe("3");
    expect(useDebuggerStore.getState().pendingRequests[42]).toBeDefined();
    expect(useDebuggerStore.getState().activeSession?.status).toBe("paused");
    actions.recordSessionEnded({ sessionId: "new", reason: "exited" });
    expect(useDebuggerStore.getState().watchResults).toEqual({});
    expect(useDebuggerStore.getState().pendingRequests).toEqual({});
  });
  it("does not register a send from an obsolete session or restore a removed watch", () => {
    const actions = useDebuggerStore.getState().actions;
    actions.registerAdapterRequest("old", 42, { command: "threads" });
    expect(useDebuggerStore.getState().pendingRequests).toEqual({});
    actions.removeWatchExpression("watch");
    actions.setWatchResult({
      expressionId: "watch",
      value: "late",
      variablesReference: 0,
      evaluatedAt: 1,
    });
    expect(useDebuggerStore.getState().watchResults).toEqual({});
  });
});
