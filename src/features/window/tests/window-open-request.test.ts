import { describe, expect, it } from "vite-plus/test";
import { __test__ } from "../utils/window-open-request";

const { parseWindowOpenUrl } = __test__;
const { resolveWindowOpenPathTarget } = __test__;
const { shouldConfirmTerminalCommand } = __test__;
const { getTerminalCommandConfirmationMessage } = __test__;
const { createWindowOpenRequestQueue } = __test__;

describe("parseWindowOpenUrl", () => {
  it("parses file with line number", () => {
    const url = new URL("athas://open?path=/Users/test/foo.txt&line=42");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/foo.txt",
      isDirectory: false,
      line: 42,
    });
  });

  it("parses file with line and column params", () => {
    const url = new URL("athas://open?path=/Users/test/foo.txt&line=42&column=7");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/foo.txt",
      isDirectory: false,
      line: 42,
      column: 7,
    });
  });

  it("parses line column pairs from the line param", () => {
    const url = new URL("athas://open?path=/Users/test/foo.txt&line=42:7");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/foo.txt",
      isDirectory: false,
      line: 42,
      column: 7,
    });
  });

  it("parses directory", () => {
    const url = new URL("athas://open?path=/Users/test/project&type=directory");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/project",
      isDirectory: true,
      line: undefined,
    });
  });

  it("parses file without line", () => {
    const url = new URL("athas://open?path=/Users/test/foo.txt");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/foo.txt",
      isDirectory: false,
      line: undefined,
    });
  });

  it("parses in-app query based window requests", () => {
    const url = new URL("http://localhost/?target=open&type=directory&path=/Users/test/project");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "path",
      path: "/Users/test/project",
      isDirectory: true,
      line: undefined,
    });
  });

  it("parses remote window requests", () => {
    const url = new URL(
      "http://localhost/?target=open&type=remote&connectionId=conn-1&name=My%20Server",
    );
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "remote",
      remoteConnectionId: "conn-1",
      remoteConnectionName: "My Server",
    });
  });

  it("parses web viewer requests", () => {
    const url = new URL("athas://open?type=web&url=https%3A%2F%2Fathas.dev%2Fdocs");
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "web",
      url: "https://athas.dev/docs",
    });
  });

  it("parses terminal requests", () => {
    const url = new URL(
      "athas://open?type=terminal&command=npm%20test&cwd=%2FUsers%2Ftest%2Fproject",
    );
    const result = parseWindowOpenUrl(url);
    expect(result).toEqual({
      type: "terminal",
      command: "npm test",
      workingDirectory: "/Users/test/project",
    });
  });

  it("returns null when path is missing", () => {
    const url = new URL("athas://open");
    expect(parseWindowOpenUrl(url)).toBeNull();
  });

  it("returns null for non-open host", () => {
    const url = new URL("athas://extension/install/foo");
    expect(parseWindowOpenUrl(url)).toBeNull();
  });

  it("ignores line=0", () => {
    const url = new URL("athas://open?path=/foo.txt&line=0");
    const result = parseWindowOpenUrl(url);
    expect(result?.line).toBeUndefined();
  });

  it("ignores column without a valid line", () => {
    const url = new URL("athas://open?path=/foo.txt&line=0&column=7");
    const result = parseWindowOpenUrl(url);
    expect(result?.line).toBeUndefined();
    expect(result?.column).toBeUndefined();
  });
});

describe("resolveWindowOpenPathTarget", () => {
  it("opens detected folders as directories even without an explicit directory request", () => {
    expect(resolveWindowOpenPathTarget(false, { is_dir: true })).toEqual({
      type: "directory",
    });
  });

  it("opens detected files as files", () => {
    expect(resolveWindowOpenPathTarget(false, { is_dir: false })).toEqual({
      type: "file",
    });
  });

  it("rejects explicit directory requests that point to files", () => {
    expect(resolveWindowOpenPathTarget(true, { is_dir: false })).toEqual({
      type: "invalid",
      message: "Path is not a folder.",
    });
  });
});

describe("terminal command confirmation", () => {
  it("requires confirmation only for deep-link terminal commands", () => {
    expect(
      shouldConfirmTerminalCommand({
        type: "terminal",
        source: "deepLink",
        command: "npm test",
      }),
    ).toBe(true);

    expect(
      shouldConfirmTerminalCommand({
        type: "terminal",
        source: "cli",
        command: "npm test",
      }),
    ).toBe(false);

    expect(
      shouldConfirmTerminalCommand({
        type: "terminal",
        source: "deepLink",
      }),
    ).toBe(false);
  });

  it("includes command and working directory in the confirmation message", () => {
    expect(
      getTerminalCommandConfirmationMessage({
        type: "terminal",
        command: "npm test",
        workingDirectory: "/Users/test/project",
      }),
    ).toBe(
      "Open a terminal and run this command?\n\nnpm test\n\nWorking directory: /Users/test/project",
    );
  });
});

describe("window open request queue", () => {
  it("runs requests sequentially", async () => {
    const events: string[] = [];
    let markFirstRequestStarted: (() => void) | undefined;
    let releaseFirstRequest: (() => void) | undefined;
    const firstRequestStarted = new Promise<void>((resolve) => {
      markFirstRequestStarted = resolve;
    });
    const firstRequestReleased = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    const queue = createWindowOpenRequestQueue(async (request) => {
      events.push(`start:${request.path}`);

      if (request.path === "/project") {
        markFirstRequestStarted?.();
        await firstRequestReleased;
      }

      events.push(`end:${request.path}`);
    });

    const firstRequest = queue({ type: "path", path: "/project" });
    const secondRequest = queue({ type: "path", path: "/project/file.ts" });

    await firstRequestStarted;
    expect(events).toEqual(["start:/project"]);

    releaseFirstRequest?.();
    await Promise.all([firstRequest, secondRequest]);

    expect(events).toEqual([
      "start:/project",
      "end:/project",
      "start:/project/file.ts",
      "end:/project/file.ts",
    ]);
  });

  it("continues after a failed request", async () => {
    const errors: unknown[] = [];
    const events: string[] = [];
    const queue = createWindowOpenRequestQueue(
      async (request) => {
        events.push(`start:${request.path}`);

        if (request.path === "/missing") {
          throw new Error("missing");
        }

        events.push(`end:${request.path}`);
      },
      (error) => errors.push(error),
    );

    await expect(queue({ type: "path", path: "/missing" })).rejects.toThrow("missing");
    await expect(queue({ type: "path", path: "/project" })).resolves.toBeUndefined();

    expect(events).toEqual(["start:/missing", "start:/project", "end:/project"]);
    expect(errors).toHaveLength(1);
  });
});
