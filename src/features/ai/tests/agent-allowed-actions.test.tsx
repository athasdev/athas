import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  allowCommandPrefix,
  getAllAllowedCommandPrefixes,
  getCommandAutoApproval,
  removeAllowedCommandPrefix,
} from "../intelligence/services/intelligence-command-allowlist";
import {
  allowMcpTool,
  getAllowedMcpTools,
  isMcpToolAllowed,
  removeAllowedMcpTool,
} from "../intelligence/services/intelligence-mcp-allowlist";
import { AgentAllowedActionsSettings } from "../components/permissions/agent-allowed-actions-settings";

vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({
      settings: {
        mcpServers: [
          {
            id: "gh",
            name: "github",
            enabled: true,
            transport: "stdio",
            command: "x",
            args: [],
            url: "",
          },
        ],
      },
    }),
}));

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});

describe("always-allowed agent actions", () => {
  it("lists command prefixes by workspace and asks again once one is removed", () => {
    allowCommandPrefix("/project/", "bun test src");
    allowCommandPrefix("/other", "cargo build");
    expect(getAllAllowedCommandPrefixes()).toEqual({
      "/project": ["bun test"],
      "/other": ["cargo build"],
    });

    removeAllowedCommandPrefix("/project", "bun test");
    expect(getCommandAutoApproval("/project", "bun test src")).toBeNull();
    expect(getAllAllowedCommandPrefixes()).toEqual({ "/other": ["cargo build"] });
  });

  it("remembers MCP tools per server until removed", () => {
    allowMcpTool("gh", "search");
    allowMcpTool("gh", "search");
    expect(isMcpToolAllowed("gh", "search")).toBe(true);
    expect(isMcpToolAllowed("other", "search")).toBe(false);
    expect(getAllowedMcpTools()).toEqual({ gh: ["search"] });

    removeAllowedMcpTool("gh", "search");
    expect(isMcpToolAllowed("gh", "search")).toBe(false);
    expect(getAllowedMcpTools()).toEqual({});
  });

  it("shows each allowed command and MCP tool with where it applies", () => {
    allowCommandPrefix("/project", "bun test src");
    allowMcpTool("gh", "search");
    allowMcpTool("gone", "deploy");
    const markup = renderToStaticMarkup(<AgentAllowedActionsSettings />);

    expect(markup).toContain("Allowed Commands");
    expect(markup).toContain("bun test");
    expect(markup).toContain("Command prefix in /project");
    expect(markup).toContain("MCP tool on github");
    expect(markup).toContain("MCP tool on a removed server");
    expect(markup).toContain('aria-label="Stop always allowing search"');
  });

  it("explains how to allow something when nothing is allowed", () => {
    expect(renderToStaticMarkup(<AgentAllowedActionsSettings />)).toContain(
      "Nothing is always allowed yet",
    );
  });
});
