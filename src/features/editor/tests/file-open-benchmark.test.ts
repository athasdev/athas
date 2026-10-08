import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/utils/frontend-trace", () => ({ frontendTrace: vi.fn() }));
vi.mock("@/utils/logger", () => ({ logger: { info: vi.fn(), debug: vi.fn() } }));

const { fileOpenBenchmark } = await import("../services/file-open-benchmark");
const { frontendTrace } = await import("@/utils/frontend-trace");

const path = "/repo/a.ts";

afterEach(() => {
  fileOpenBenchmark.cancel(path);
  vi.restoreAllMocks();
  vi.mocked(frontendTrace).mockClear();
});

describe("file open benchmark", () => {
  it("keeps the session an explorer click started for the open it triggers", () => {
    fileOpenBenchmark.ensureStarted(path, "explorer-click");
    fileOpenBenchmark.mark(path, "explorer-click");

    fileOpenBenchmark.ensureStarted(path, "definite");

    expect(fileOpenBenchmark.hasMark(path, "explorer-click")).toBe(true);
  });

  it("starts a fresh session for a new open of the same path", () => {
    fileOpenBenchmark.ensureStarted(path, "definite");
    fileOpenBenchmark.mark(path, "file-select-handler");
    fileOpenBenchmark.mark(path, "buffer-opened");

    fileOpenBenchmark.ensureStarted(path, "definite");

    expect(fileOpenBenchmark.hasMark(path, "buffer-opened")).toBe(false);
  });

  it("replaces a session left over from an open that never finished", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    fileOpenBenchmark.ensureStarted(path, "explorer-click");
    fileOpenBenchmark.mark(path, "explorer-click");

    now.mockReturnValue(20_000);
    fileOpenBenchmark.ensureStarted(path, "definite");

    expect(fileOpenBenchmark.hasMark(path, "explorer-click")).toBe(false);
  });

  it("marks a phase once per session", () => {
    fileOpenBenchmark.ensureStarted(path, "definite");
    fileOpenBenchmark.markOnce(path, "pane-rendered");
    fileOpenBenchmark.markOnce(path, "pane-rendered");
    fileOpenBenchmark.finish(path, "editor-painted");

    const payload = vi.mocked(frontendTrace).mock.calls[0]?.[3] as {
      phases: Array<{ label: string }>;
    };
    expect(payload.phases.map((phase) => phase.label)).toEqual([
      "start",
      "pane-rendered",
      "editor-painted",
    ]);
  });
});
