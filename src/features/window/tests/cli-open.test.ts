import { describe, expect, it } from "vite-plus/test";
import { __test__ } from "../hooks/use-cli-open";

const { mapCliOpenPayloadToWindowOpenRequest } = __test__;

describe("CLI open request mapping", () => {
  it("maps path payloads into queued window open requests", () => {
    expect(
      mapCliOpenPayloadToWindowOpenRequest({
        kind: "path",
        path: "/Users/test/project/file.ts",
        is_directory: false,
        line: 42,
        column: 7,
      }),
    ).toEqual({
      type: "path",
      source: "cli",
      path: "/Users/test/project/file.ts",
      isDirectory: false,
      line: 42,
      column: 7,
    });
  });

  it("ignores invalid path positions consistently with deep-link parsing", () => {
    expect(
      mapCliOpenPayloadToWindowOpenRequest({
        kind: "path",
        path: "/Users/test/project/file.ts",
        line: 0,
        column: 7,
      }),
    ).toEqual({
      type: "path",
      source: "cli",
      path: "/Users/test/project/file.ts",
      isDirectory: false,
      line: undefined,
      column: undefined,
    });
  });

  it("maps terminal, web, and remote payloads", () => {
    expect(
      mapCliOpenPayloadToWindowOpenRequest({
        kind: "terminal",
        command: "bun test",
        working_directory: "/Users/test/project",
      }),
    ).toEqual({
      type: "terminal",
      source: "cli",
      command: "bun test",
      workingDirectory: "/Users/test/project",
    });

    expect(
      mapCliOpenPayloadToWindowOpenRequest({
        kind: "web",
        url: "https://athas.dev/docs",
      }),
    ).toEqual({
      type: "web",
      source: "cli",
      url: "https://athas.dev/docs",
    });

    expect(
      mapCliOpenPayloadToWindowOpenRequest({
        kind: "remote",
        connection_id: "conn-1",
        name: "My Server",
      }),
    ).toEqual({
      type: "remote",
      source: "cli",
      remoteConnectionId: "conn-1",
      remoteConnectionName: "My Server",
    });
  });

  it("drops incomplete payloads before they reach the request queue", () => {
    expect(mapCliOpenPayloadToWindowOpenRequest({ kind: "path" })).toBeNull();
    expect(mapCliOpenPayloadToWindowOpenRequest({ kind: "web" })).toBeNull();
    expect(mapCliOpenPayloadToWindowOpenRequest({ kind: "remote" })).toBeNull();
  });
});
