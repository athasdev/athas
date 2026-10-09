// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const api = vi.hoisted(() => ({ logs: vi.fn() }));
vi.mock("../cloud-agents/cloud-agents-api", () => ({ getCloudAgentRunLogs: api.logs }));

import { useCloudAgentLogs } from "../cloud-agents/use-cloud-agent-logs";

type Logs = ReturnType<typeof useCloudAgentLogs>;
let root: Root;
let logs: Logs;

function Harness({ runId, active }: { runId: string; active: boolean }) {
  logs = useCloudAgentLogs(runId, active);
  return null;
}

const line = (n: number) => ({ at: n, stream: "stdout" as const, text: `line ${n}` });

async function render(runId: string, active: boolean) {
  await act(async () => root.render(createElement(Harness, { runId, active })));
  await act(async () => {});
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  api.logs.mockReset();
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("useCloudAgentLogs", () => {
  it("reads every full page from the start", async () => {
    const fullPage = Array.from({ length: 500 }, (_, index) => line(index));
    api.logs
      .mockResolvedValueOnce({ cursor: 500, lines: fullPage })
      .mockResolvedValueOnce({ cursor: 501, lines: [line(500)] });

    await render("run-1", false);

    expect(api.logs.mock.calls).toEqual([
      ["run-1", 0],
      ["run-1", 500],
    ]);
    expect(logs.lines).toHaveLength(501);
    expect(logs.error).toBeNull();
  });

  it("follows an active run from its cursor", async () => {
    api.logs
      .mockResolvedValueOnce({ cursor: 1, lines: [line(0)] })
      .mockResolvedValueOnce({ cursor: 1, lines: [] })
      .mockResolvedValueOnce({ cursor: 2, lines: [line(1)] });

    await render("run-2", true);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    await act(async () => vi.advanceTimersByTimeAsync(3000));

    expect(api.logs.mock.calls.map(([, cursor]) => cursor)).toEqual([0, 1, 1]);
    expect(logs.lines.map((item) => item.at)).toEqual([0, 1]);
  });

  it("shows why logs are unavailable and recovers on the next poll", async () => {
    api.logs
      .mockRejectedValueOnce(new Error("Run not found"))
      .mockRejectedValueOnce("offline")
      .mockResolvedValueOnce({ cursor: 1, lines: [line(0)] });

    await render("run-3", true);
    expect(logs.error).toBe("Run not found");
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(logs.error).toBe("Logs are unavailable.");
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(logs.error).toBeNull();
    expect(logs.lines).toHaveLength(1);
  });

  it("starts over for another run and stops polling a finished one", async () => {
    api.logs.mockResolvedValue({ cursor: 1, lines: [line(0)] });
    await render("run-a", true);
    await render("run-b", false);
    expect(logs.lines).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(9000));
    expect(api.logs.mock.calls.map(([runId]) => runId)).toEqual(["run-a", "run-b"]);
  });
});
