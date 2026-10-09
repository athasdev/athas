// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const events = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: unknown }) => void),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => {
    events.handler = handler;
    return events.unlisten;
  }),
}));

import { commands } from "@/bindings/commands";
import { useAcpTraffic } from "../acp-inspector/hooks/use-acp-traffic";

type Traffic = ReturnType<typeof useAcpTraffic>;

function processInfo(processKey: string, running = true, startedAtMs = 1) {
  return { processKey, running, startedAtMs, agentId: processKey } as never;
}

function entry(seq: number, line = `{"seq":${seq}}`) {
  return { seq, timestampMs: seq, direction: "out", line, truncated: false } as never;
}

let root: Root;
let traffic: Traffic;

function Harness() {
  traffic = useAcpTraffic();
  return null;
}

async function mount() {
  await act(async () => root.render(createElement(Harness)));
  await act(async () => {});
}

async function emit(payload: unknown) {
  await act(async () => events.handler!({ payload }));
}

async function tick(ms = 150) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  events.handler = null;
  vi.spyOn(commands, "subscribeAcpTraffic").mockResolvedValue(undefined as never);
  vi.spyOn(commands, "unsubscribeAcpTraffic").mockResolvedValue(undefined as never);
  vi.spyOn(commands, "getAcpTrafficProcesses").mockResolvedValue([
    processInfo("old", false, 1),
    processInfo("live", true, 2),
  ] as never);
  vi.spyOn(commands, "getAcpTraffic").mockImplementation(
    async (key: string) =>
      ({
        process: processInfo(key, true, 2),
        entries: [entry(1), entry(2)],
        initialize: { request: { method: "initialize" }, response: null },
      }) as never,
  );
  vi.spyOn(commands, "clearAcpTraffic").mockResolvedValue(undefined as never);
  vi.spyOn(commands, "exportAcpTraffic").mockResolvedValue(undefined as never);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAcpTraffic", () => {
  it("selects the first process and loads its backlog", async () => {
    await mount();

    expect(commands.subscribeAcpTraffic).toHaveBeenCalled();
    expect(traffic.processes.map((item) => item.processKey)).toEqual(["old", "live"]);
    expect(traffic.selectedProcess?.processKey).toBe("old");
    expect(commands.getAcpTraffic).toHaveBeenCalledWith("old");
    expect(traffic.entries.map((item) => item.seq)).toEqual([1, 2]);
    expect(traffic.initialize).toEqual({ request: { method: "initialize" }, response: null });
    expect(traffic.isLoading).toBe(false);
  });

  it("batches live lines for the selected process and ignores others", async () => {
    await mount();

    await emit({ type: "entries", processKey: "old", entries: [entry(3), entry(2)] });
    await emit({ type: "entries", processKey: "live", entries: [entry(9)] });
    expect(traffic.entries.map((item) => item.seq)).toEqual([1, 2]);
    await tick();
    expect(traffic.entries.map((item) => item.seq)).toEqual([1, 2, 3]);

    await emit({ type: "initialize", processKey: "old", initialize: { request: 1, response: 2 } });
    await emit({ type: "initialize", processKey: "live", initialize: { request: 3, response: 4 } });
    expect(traffic.initialize).toEqual({ request: 1, response: 2 });
  });

  it("keeps running processes first and reloads a restarted process", async () => {
    await mount();

    await emit({ type: "process", process: processInfo("new", true, 5) });
    expect(traffic.processes.map((item) => item.processKey)).toEqual(["new", "live", "old"]);

    vi.mocked(commands.getAcpTraffic).mockClear();
    await emit({ type: "process", process: processInfo("old", true, 9) });
    expect(commands.getAcpTraffic).toHaveBeenCalledWith("old");
  });

  it("switches processes, clears and exports the selected log", async () => {
    await mount();
    await act(async () => traffic.selectProcess("live"));
    await act(async () => {});
    expect(commands.getAcpTraffic).toHaveBeenLastCalledWith("live");

    await act(async () => traffic.clear());
    expect(commands.clearAcpTraffic).toHaveBeenCalledWith("live");
    expect(traffic.entries).toEqual([]);

    await act(async () => traffic.exportTo("/tmp/traffic.jsonl"));
    expect(commands.exportAcpTraffic).toHaveBeenCalledWith("live", "/tmp/traffic.jsonl");
  });

  it("shows backlog failures", async () => {
    vi.mocked(commands.getAcpTraffic).mockRejectedValue("process not found");
    await mount();
    expect(traffic.error).toBe("process not found");
    expect(traffic.isLoading).toBe(false);
  });

  it("shows subscription failures and does nothing without a process", async () => {
    vi.mocked(commands.getAcpTrafficProcesses).mockResolvedValue([] as never);
    vi.mocked(commands.subscribeAcpTraffic).mockRejectedValue("bridge down");
    await mount();

    expect(traffic.error).toBe("bridge down");
    expect(traffic.selectedProcess).toBeNull();
    await act(async () => traffic.clear());
    await act(async () => traffic.exportTo("/x"));
    expect(commands.clearAcpTraffic).not.toHaveBeenCalled();
    expect(commands.exportAcpTraffic).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", async () => {
    await mount();
    await act(async () => root.unmount());
    expect(events.unlisten).toHaveBeenCalled();
    expect(commands.unsubscribeAcpTraffic).toHaveBeenCalled();
    root = createRoot(document.createElement("div"));
  });
});
