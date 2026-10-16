import { describe, expect, it } from "vite-plus/test";
import { MCP_CATALOG, MCP_CATALOG_GROUPS } from "@/features/ai/customize/constants/mcp-catalog";
import {
  buildCustomizeAgents,
  buildInstalledMcpRows,
  buildInstalledNavigationItems,
  buildMcpCatalogGroups,
  buildSkillCatalogRows,
  createMcpDraftFromCatalog,
  findCatalogEntry,
  groupCustomizeAgents,
  isCatalogServer,
  parseCustomizeNavigationValue,
} from "@/features/ai/customize/services/customize-catalog";
import type { McpCatalogEntry } from "@/features/ai/customize/types/customize.types";
import {
  hasMcpServerDraftErrors,
  validateMcpServerDraft,
} from "@/features/ai/services/mcp-servers";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { McpServerSetting } from "@/features/ai/types/mcp-server.types";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";

const entry = (id: string) => MCP_CATALOG.find((item) => item.id === id) as McpCatalogEntry;

function server(changes: Partial<McpServerSetting>): McpServerSetting {
  return {
    id: changes.name ?? "server",
    name: "server",
    enabled: true,
    transport: "stdio",
    command: "",
    args: [],
    url: "",
    ...changes,
  };
}

function agent(changes: Partial<AgentConfig>): AgentConfig {
  return {
    id: "agent",
    name: "Agent",
    binaryName: "agent",
    binaryPath: null,
    args: [],
    envVars: {},
    icon: null,
    description: null,
    installed: false,
    installRuntime: null,
    installPackage: null,
    availableVersion: null,
    installedVersion: null,
    updateAvailable: false,
    managed: false,
    canInstall: true,
    ...changes,
  };
}

describe("MCP catalog data", () => {
  it("has unique ids in known groups, and every entry makes a valid draft", () => {
    const ids = MCP_CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(MCP_CATALOG_GROUPS.map((group) => group.id));
    for (const item of MCP_CATALOG) {
      expect(groups.has(item.group)).toBe(true);
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      const errors = validateMcpServerDraft(createMcpDraftFromCatalog(item), []);
      expect(hasMcpServerDraftErrors(errors), item.id).toBe(false);
    }
  });

  it("names the secrets a server needs without filling them in", () => {
    expect(createMcpDraftFromCatalog(entry("github"))).toMatchObject({
      id: null,
      name: "github",
      transport: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: [{ name: "Authorization", value: "" }],
    });
    expect(createMcpDraftFromCatalog(entry("postgres"))).toMatchObject({
      transport: "stdio",
      command: "uvx",
      argsText: "postgres-mcp\n--access-mode=restricted",
      env: [{ name: "DATABASE_URI", value: "" }],
    });
  });
});

describe("matching configured servers to the catalog", () => {
  it("recognises a server by name, remote URL or the package it runs", () => {
    expect(isCatalogServer(entry("linear"), server({ name: "Linear" }))).toBe(true);
    expect(
      isCatalogServer(
        entry("linear"),
        server({ name: "work", transport: "http", url: "https://mcp.linear.app/mcp/" }),
      ),
    ).toBe(true);
    expect(
      isCatalogServer(
        entry("playwright"),
        server({ name: "browser", command: "npx", args: ["-y", "@playwright/mcp@0.0.40"] }),
      ),
    ).toBe(true);
    expect(
      isCatalogServer(entry("playwright"), server({ name: "x", command: "npx", args: ["other"] })),
    ).toBe(false);
  });

  it("pairs catalog rows with installed servers and filters by the query", () => {
    const linear = server({ id: "l1", name: "linear", transport: "http" });
    const groups = buildMcpCatalogGroups([linear]);
    expect(groups[0]?.id).toBe("popular");
    const row = groups.flatMap((group) => group.rows).find((item) => item.entry.id === "linear");
    expect(row?.server).toBe(linear);
    expect(
      groups.flatMap((group) => group.rows).find((item) => item.entry.id === "sentry")?.server,
    ).toBeUndefined();

    const searched = buildMcpCatalogGroups([], "postgres");
    expect(searched.map((group) => group.rows.map((item) => item.entry.id))).toEqual([
      ["postgres"],
    ]);
  });

  it("lists every configured server as installed, catalog or not", () => {
    const rows = buildInstalledMcpRows([
      server({ id: "c", name: "internal-tools", command: "node", args: ["server.js"] }),
      server({ id: "g", name: "github", transport: "http", url: "https://x" }),
    ]);
    expect(rows.map((row) => [row.server.id, row.entry?.id])).toEqual([
      ["g", "github"],
      ["c", undefined],
    ]);
    expect(findCatalogEntry(rows[1].server)).toBeUndefined();
  });
});

describe("agents", () => {
  const agents = buildCustomizeAgents({
    codexInstalled: false,
    agents: [
      agent({ id: "zed", name: "Zed Agent", source: "registry", installed: true }),
      agent({ id: "gemini-cli", name: "Gemini CLI", source: "extension" }),
      agent({
        id: "locked",
        name: "Locked",
        source: "registry",
        canInstall: false,
        registry: { unavailableReason: "No build for this platform" } as never,
      }),
      agent({
        id: "claude-acp",
        name: "Claude",
        installed: true,
        updateAvailable: true,
      }),
    ],
  });

  it("puts Codex and the agents Athas ships first, then the registry", () => {
    expect(agents.map((item) => item.id)).toEqual([
      "claude-acp",
      "codex",
      "gemini-cli",
      "locked",
      "zed",
    ]);
    expect(groupCustomizeAgents(agents).map((group) => group.id)).toEqual(["featured", "registry"]);
  });

  it("explains why an agent cannot be installed and marks updates", () => {
    const byId = new Map(agents.map((item) => [item.id, item]));
    expect(byId.get("codex")).toMatchObject({
      isCodex: true,
      isInstalled: false,
      canInstall: false,
    });
    expect(byId.get("locked")?.unavailableReason).toBe("No build for this platform");
    expect(byId.get("claude-acp")).toMatchObject({ updateAvailable: true });
    expect(byId.get("claude-acp")?.brand).toMatchObject({ kind: "image" });
  });

  it("lists installed servers and agents in the navigation and routes back to them", () => {
    const items = buildInstalledNavigationItems(
      [server({ id: "s1", name: "github", transport: "http", url: "https://x" })],
      agents,
    );
    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["mcp:s1", "GitHub"],
      ["agents:claude-acp", "Claude"],
      ["agents:zed", "Zed Agent"],
    ]);
    expect(parseCustomizeNavigationValue("mcp:s1")).toEqual({ section: "mcp", itemId: "s1" });
    expect(parseCustomizeNavigationValue("skills")).toEqual({ section: "skills" });
    expect(parseCustomizeNavigationValue("nope")).toBeNull();
  });
});

describe("skills", () => {
  it("pairs catalog skills with the installed copy", () => {
    const review: MarketplaceSkill = { id: "review", title: "Review", description: "", tags: [] };
    const docs: MarketplaceSkill = {
      id: "docs",
      title: "Docs",
      description: "",
      tags: ["writing"],
    };
    const installed = { id: "skill-1", sourceId: "review", title: "Review" } as AIChatSkill;

    const rows = buildSkillCatalogRows([review, docs], [installed]);
    expect(rows.map((row) => [row.skill.id, row.installed?.id])).toEqual([
      ["docs", undefined],
      ["review", "skill-1"],
    ]);
    expect(buildSkillCatalogRows([review, docs], [], "writing").map((row) => row.skill.id)).toEqual(
      ["docs"],
    );
  });
});
