import { describe, expect, it } from "vite-plus/test";
import {
  dockerContainerLogsReducer,
  getDockerLogExitError,
  initialDockerContainerLogsState,
  maxDockerLogLines,
  type DockerContainerLogsState,
  type DockerLogLine,
} from "../hooks/use-docker-container-logs";

const state = (overrides: Partial<DockerContainerLogsState> = {}): DockerContainerLogsState => ({
  ...initialDockerContainerLogsState,
  ...overrides,
});

const line = (id: number, value = `line-${id}`): DockerLogLine => ({
  id,
  streamId: "stream-a",
  containerId: "container-a",
  stream: "stdout",
  line: value,
});

describe("Docker container logs controller", () => {
  it("resets stream data without discarding the active query and filter", () => {
    expect(
      dockerContainerLogsReducer(
        state({
          lines: [line(1)],
          query: "error",
          filter: "stderr",
          streamId: "stream-a",
          error: "failed",
        }),
        { type: "container-changed" },
      ),
    ).toEqual(
      state({
        query: "error",
        filter: "stderr",
      }),
    );
  });

  it("keeps only the newest bounded set of log lines", () => {
    const fullState = state({
      lines: Array.from({ length: maxDockerLogLines }, (_, index) => line(index)),
    });
    const next = dockerContainerLogsReducer(fullState, {
      type: "line-received",
      line: line(maxDockerLogLines),
    });

    expect(next.lines).toHaveLength(maxDockerLogLines);
    expect(next.lines[0]?.id).toBe(1);
    expect(next.lines[next.lines.length - 1]?.id).toBe(maxDockerLogLines);
  });

  it("records stream startup, exit, and startup failures independently", () => {
    const started = dockerContainerLogsReducer(state(), {
      type: "stream-started",
      streamId: "stream-a",
    });
    const exited = dockerContainerLogsReducer(started, {
      type: "stream-exited",
      error: "stream crashed",
    });
    const failed = dockerContainerLogsReducer(state(), {
      type: "stream-failed",
      error: "could not start",
    });

    expect(started.streamId).toBe("stream-a");
    expect(exited).toMatchObject({ streamId: null, error: "stream crashed" });
    expect(failed).toMatchObject({ streamId: null, error: "could not start" });
  });

  it("normalizes native exit payloads into user-facing errors", () => {
    expect(
      getDockerLogExitError({
        streamId: "stream-a",
        containerId: "container-a",
        error: "permission denied",
        code: 1,
      }),
    ).toBe("permission denied");
    expect(
      getDockerLogExitError({
        streamId: "stream-a",
        containerId: "container-a",
        code: 137,
      }),
    ).toBe("Docker log stream exited with code 137.");
    expect(
      getDockerLogExitError({
        streamId: "stream-a",
        containerId: "container-a",
        code: 0,
      }),
    ).toBeNull();
  });
});
