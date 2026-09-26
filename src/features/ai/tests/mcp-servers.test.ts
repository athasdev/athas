import { describe, expect, it } from "vite-plus/test";
import {
  createMcpServerDraft,
  formatSkippedMcpServersNotice,
  hasMcpServerDraftErrors,
  normalizeMcpServers,
  splitMcpServerDraft,
  validateMcpServerDraft,
} from "@/features/ai/lib/mcp-servers";
import type { McpServerDraft, McpServerSetting } from "@/features/ai/types/mcp-server.types";
import { normalizeSettingValue } from "@/features/settings/lib/settings-normalization";

const linear: McpServerSetting = {
  id: "linear-1",
  name: "linear",
  enabled: true,
  transport: "http",
  command: "",
  args: [],
  url: "https://mcp.linear.app/mcp",
};

function draft(changes: Partial<McpServerDraft>): McpServerDraft {
  return { ...createMcpServerDraft(), ...changes };
}

describe("normalizeMcpServers", () => {
  it("keeps well-formed servers and fills optional fields", () => {
    expect(
      normalizeMcpServers([
        { id: "fs", name: " files ", transport: "stdio", command: "npx", args: ["-y", 3] },
      ]),
    ).toEqual([
      {
        id: "fs",
        name: "files",
        enabled: true,
        transport: "stdio",
        command: "npx",
        args: ["-y"],
        url: "",
      },
    ]);
  });

  it("drops malformed entries, unknown transports, unsafe ids and duplicates", () => {
    expect(
      normalizeMcpServers([
        null,
        "linear",
        { id: "a", name: "", transport: "stdio" },
        { id: "b", name: "ws", transport: "websocket" },
        { id: "../escape", name: "bad", transport: "http" },
        linear,
        { ...linear, name: "copy" },
        { ...linear, id: "off", name: "disabled", enabled: false },
      ]),
    ).toEqual([linear, { ...linear, id: "off", name: "disabled", enabled: false }]);
    expect(normalizeMcpServers({ servers: [] })).toEqual([]);
  });

  it("runs when the setting is updated", () => {
    expect(normalizeSettingValue("mcpServers", [linear, { id: 1 }] as never)).toEqual([linear]);
  });
});

describe("validateMcpServerDraft", () => {
  it("accepts a complete stdio server", () => {
    const errors = validateMcpServerDraft(
      draft({ name: "files", command: "npx", env: [{ name: "API_KEY", value: "x" }] }),
      [linear],
    );
    expect(hasMcpServerDraftErrors(errors)).toBe(false);
  });

  it("requires a unique name and the transport's target", () => {
    expect(validateMcpServerDraft(draft({}), [])).toEqual({
      name: "Enter a name",
      command: "Enter the command that starts the server",
    });
    expect(
      validateMcpServerDraft(draft({ name: "LINEAR", transport: "sse", url: "" }), [linear]),
    ).toEqual({
      name: "Another server already uses this name",
      url: "Enter the server URL",
    });
  });

  it("lets a server keep its own name when edited", () => {
    const editing = createMcpServerDraft(linear, { env: [], headers: [] });
    expect(validateMcpServerDraft(editing, [linear])).toEqual({});
  });

  it("only accepts http and https URLs", () => {
    expect(
      validateMcpServerDraft(draft({ name: "x", transport: "http", url: "file:///etc" }), []).url,
    ).toBe("Use an http:// or https:// URL");
    expect(
      validateMcpServerDraft(draft({ name: "x", transport: "http", url: "not a url" }), []).url,
    ).toBe("Use an http:// or https:// URL");
  });

  it("checks environment variable and header names", () => {
    expect(
      validateMcpServerDraft(
        draft({ name: "x", command: "c", env: [{ name: "BAD-NAME", value: "1" }] }),
        [],
      ).env,
    ).toBe('"BAD-NAME" is not a valid variable name');
    expect(
      validateMcpServerDraft(
        draft({ name: "x", command: "c", env: [{ name: "", value: "1" }] }),
        [],
      ).env,
    ).toBe("Every variable with a value needs a name");
    expect(
      validateMcpServerDraft(
        draft({
          name: "x",
          transport: "http",
          url: "https://a",
          headers: [
            { name: "Authorization", value: "a" },
            { name: "authorization", value: "b" },
          ],
        }),
        [],
      ).headers,
    ).toBe("authorization is set more than once");
  });

  it("ignores empty rows and fields of the other transport", () => {
    expect(
      validateMcpServerDraft(
        draft({
          name: "x",
          transport: "http",
          url: "https://a",
          command: "",
          env: [{ name: "BAD-NAME", value: "1" }],
          headers: [{ name: "", value: "" }],
        }),
        [],
      ),
    ).toEqual({});
  });
});

describe("splitMcpServerDraft", () => {
  it("keeps secrets out of the stored server and clears unused fields", () => {
    const { server, secrets } = splitMcpServerDraft(
      draft({
        name: " files ",
        command: " npx ",
        argsText: "-y\n\n  @scope/server  \n.",
        url: "https://stale",
        env: [
          { name: " TOKEN ", value: " secret " },
          { name: "", value: "" },
        ],
        headers: [{ name: "Authorization", value: "stale" }],
      }),
      "id-1",
    );

    expect(server).toEqual({
      id: "id-1",
      name: "files",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@scope/server", "."],
      url: "",
    });
    expect(secrets).toEqual({ env: [{ name: "TOKEN", value: " secret " }], headers: [] });
    expect(JSON.stringify(server)).not.toContain("secret");
  });

  it("round-trips an existing server through a draft", () => {
    const secrets = { env: [], headers: [{ name: "Authorization", value: "Bearer a" }] };
    expect(splitMcpServerDraft(createMcpServerDraft(linear, secrets), linear.id)).toEqual({
      server: linear,
      secrets,
    });
  });
});

describe("formatSkippedMcpServersNotice", () => {
  it("names each skipped server and its transport", () => {
    expect(formatSkippedMcpServersNotice("gemini", [])).toBeNull();
    expect(
      formatSkippedMcpServersNotice("gemini", [
        { name: "linear", transport: "http" },
        { name: "events", transport: "sse" },
      ]),
    ).toBe(
      "gemini cannot use these MCP servers, so they were not passed to it: linear (HTTP), events (SSE).",
    );
  });
});
