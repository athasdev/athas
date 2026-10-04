// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("../services/debug-adapter-service", () => ({
  sendDebugAdapterRequest: vi.fn(async () => 1),
}));
import { sendDebugAdapterRequest } from "../services/debug-adapter-service";
import { useDebuggerStore } from "../stores/debugger.store";
import { DebugWatchPanel } from "../components/debugger-watch-panel";
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  useDebuggerStore.getState().actions.startSession({
    id: "session",
    name: "Debug",
    configId: "node",
    command: "node",
    status: "paused",
    startedAt: 1,
  });
  useDebuggerStore.getState().actions.selectStackFrame(1);
  useDebuggerStore.setState({ watchExpressions: [], watchResults: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});
it("evaluates a newly added watch once without duplicate side effects", async () => {
  await act(async () =>
    root.render(
      <DebugWatchPanel
        activeSessionId="session"
        selectedFrameId={1}
        isPaused
        pendingRequests={{}}
      />,
    ),
  );
  const input = container.querySelector<HTMLInputElement>('input[placeholder="Add expression"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "counter",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Add watch"]')!.click(),
  );
  expect(sendDebugAdapterRequest).toHaveBeenCalledExactlyOnceWith("session", "evaluate", {
    expression: "counter",
    frameId: 1,
    context: "watch",
  });
  expect(useDebuggerStore.getState().watchExpressions).toHaveLength(1);
  expect(useDebuggerStore.getState().pendingRequests[1]).toMatchObject({
    frameId: 1,
    inspectionRevision: useDebuggerStore.getState().inspectionRevision,
  });
});

it("does not register a watch send that completes after leaving the frame", async () => {
  let finish: (seq: number) => void = () => {};
  vi.mocked(sendDebugAdapterRequest).mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  useDebuggerStore.getState().actions.addWatchExpression("counter");
  await act(async () =>
    root.render(
      <DebugWatchPanel
        activeSessionId="session"
        selectedFrameId={1}
        isPaused
        pendingRequests={{}}
      />,
    ),
  );
  await act(async () => {
    useDebuggerStore.getState().actions.selectStackFrame(2);
    finish(1);
  });
  expect(useDebuggerStore.getState().pendingRequests).toEqual({});
});
