import { createMcpServerDraft } from "@/features/ai/services/mcp-servers";
import { isMarketplaceSkillInstalled } from "@/features/ai/services/skill-library";
import {
  BUILT_IN_AI_INTEGRATIONS,
  CODEX_INTEGRATION_ID,
} from "@/features/ai/integrations/integration-registry";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { McpServerDraft, McpServerSetting } from "@/features/ai/types/mcp-server.types";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import { agentBrandImages } from "@/ui/brand-marks";
import { MCP_CATALOG, MCP_CATALOG_GROUPS } from "../constants/mcp-catalog";
import type {
  CustomizeAgent,
  CustomizeBrand,
  CustomizeInstalledItem,
  CustomizeSection,
  McpCatalogEntry,
} from "../types/customize.types";

export interface CustomizeGroup<T> {
  id: string;
  label: string;
  rows: T[];
}

/** Whether any of `fields` contains the query, ignoring case; an empty query matches all. */
export function matchesCustomizeQuery(query: string, ...fields: Array<string | undefined | null>) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return fields.some((field) => field?.toLowerCase().includes(normalized));
}

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** The npm or PyPI package a stdio command runs, without its version. */
function packageOf(args: readonly string[]) {
  const name = args.find((arg) => !arg.startsWith("-"));
  return name?.replace(/(.)@[^/]*$/, "$1");
}

/**
 * Whether a configured server is this catalog entry: the same name, the same remote URL, or the
 * same command running the same package. Users rename servers, so the name alone is not enough.
 */
export function isCatalogServer(entry: McpCatalogEntry, server: McpServerSetting) {
  const name = server.name.trim().toLowerCase();
  if (name === entry.id || name === entry.name.toLowerCase()) return true;
  if (entry.config.transport === "stdio") {
    return (
      server.transport === "stdio" &&
      server.command === entry.config.command &&
      packageOf(server.args) === packageOf(entry.config.args)
    );
  }
  return (
    server.transport !== "stdio" && normalizeUrl(server.url) === normalizeUrl(entry.config.url)
  );
}

export function findCatalogEntry(server: McpServerSetting, catalog = MCP_CATALOG) {
  return catalog.find((entry) => isCatalogServer(entry, server));
}

/** A dialog draft for adding a catalog server, its secrets named but left for the user. */
export function createMcpDraftFromCatalog(entry: McpCatalogEntry): McpServerDraft {
  const draft = { ...createMcpServerDraft(), name: entry.id };
  const { config } = entry;
  if (config.transport === "stdio") {
    return {
      ...draft,
      transport: "stdio",
      command: config.command,
      argsText: config.args.join("\n"),
      env: (config.env ?? []).map((name) => ({ name, value: "" })),
    };
  }
  return {
    ...draft,
    transport: config.transport,
    url: config.url,
    headers: (config.headers ?? []).map((name) => ({ name, value: "" })),
  };
}

export interface McpCatalogRow {
  entry: McpCatalogEntry;
  server?: McpServerSetting;
}

/** The catalog in its groups, each entry paired with the configured server it matches. */
export function buildMcpCatalogGroups(
  servers: readonly McpServerSetting[],
  query = "",
  catalog = MCP_CATALOG,
): CustomizeGroup<McpCatalogRow>[] {
  return MCP_CATALOG_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    rows: catalog
      .filter((entry) => entry.group === group.id)
      .filter((entry) => matchesCustomizeQuery(query, entry.name, entry.description, entry.id))
      .map((entry) => ({
        entry,
        server: servers.find((server) => isCatalogServer(entry, server)),
      })),
  })).filter((group) => group.rows.length > 0);
}

export interface InstalledMcpRow {
  server: McpServerSetting;
  entry?: McpCatalogEntry;
}

/** Every configured server, including ones the catalog does not know, by name. */
export function buildInstalledMcpRows(
  servers: readonly McpServerSetting[],
  query = "",
  catalog = MCP_CATALOG,
): InstalledMcpRow[] {
  return servers
    .map((server) => ({ server, entry: findCatalogEntry(server, catalog) }))
    .filter(({ server, entry }) =>
      matchesCustomizeQuery(
        query,
        server.name,
        entry?.name,
        entry?.description,
        server.url,
        server.command,
      ),
    )
    .sort((left, right) => left.server.name.localeCompare(right.server.name));
}

function agentBrand(id: string, iconUrl: string | null | undefined): CustomizeBrand | undefined {
  const image = agentBrandImages[id];
  if (image) return { kind: "image", src: image };
  if (iconUrl || id === CODEX_INTEGRATION_ID) return { kind: "provider", providerId: id, iconUrl };
  return undefined;
}

/**
 * The agents Customize lists: Codex, the agents Athas ships a manifest for, and every agent the
 * ACP Registry offers, sorted by name with the featured ones first.
 */
export function buildCustomizeAgents({
  agents,
  codexInstalled,
}: {
  agents: readonly AgentConfig[];
  codexInstalled: boolean;
}): CustomizeAgent[] {
  const codex = BUILT_IN_AI_INTEGRATIONS.map((integration) => ({
    id: integration.id,
    name: integration.name,
    description: integration.description,
    brand: agentBrand(integration.id, null),
    isInstalled: codexInstalled,
    canInstall: false,
    updateAvailable: false,
    isFeatured: true,
    unavailableReason: codexInstalled ? undefined : "Install the Codex CLI to use it here",
    isCodex: true,
  }));
  const acpAgents = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description ?? "ACP-compatible coding agent",
    brand: agentBrand(agent.id, agent.icon),
    isInstalled: agent.installed,
    canInstall: agent.canInstall,
    updateAvailable: agent.installed && agent.canInstall && agent.updateAvailable,
    isFeatured: agent.source !== "registry",
    unavailableReason:
      agent.installed || agent.canInstall
        ? undefined
        : (agent.registry?.unavailableReason ?? "Cannot be installed automatically"),
    isCodex: false,
  }));
  return [...codex, ...acpAgents].sort(
    (left, right) =>
      Number(right.isFeatured) - Number(left.isFeatured) || left.name.localeCompare(right.name),
  );
}

export function groupCustomizeAgents(
  agents: readonly CustomizeAgent[],
  query = "",
): CustomizeGroup<CustomizeAgent>[] {
  const visible = agents.filter((agent) =>
    matchesCustomizeQuery(query, agent.name, agent.description, agent.id),
  );
  return [
    { id: "featured", label: "Featured", rows: visible.filter((agent) => agent.isFeatured) },
    { id: "registry", label: "ACP Registry", rows: visible.filter((agent) => !agent.isFeatured) },
  ].filter((group) => group.rows.length > 0);
}

export interface SkillCatalogRow {
  skill: MarketplaceSkill;
  installed?: AIChatSkill;
}

export function buildSkillCatalogRows(
  marketplaceSkills: readonly MarketplaceSkill[],
  aiSkills: AIChatSkill[],
  query = "",
): SkillCatalogRow[] {
  return marketplaceSkills
    .filter((skill) => matchesCustomizeQuery(query, skill.title, skill.description, ...skill.tags))
    .map((skill) => ({
      skill,
      installed: isMarketplaceSkillInstalled(aiSkills, skill.id)
        ? aiSkills.find((item) => item.sourceId === skill.id || item.id === skill.id)
        : undefined,
    }))
    .sort((left, right) => left.skill.title.localeCompare(right.skill.title));
}

export function filterPersonalSkills(skills: readonly AIChatSkill[], query = "") {
  return skills
    .filter((skill) => matchesCustomizeQuery(query, skill.title, skill.description, skill.content))
    .sort((left, right) => left.title.localeCompare(right.title));
}

const INSTALLED_ITEM_SEPARATOR = ":";

/** The navigation's Installed group: configured MCP servers, then installed agents. */
export function buildInstalledNavigationItems(
  servers: readonly McpServerSetting[],
  agents: readonly CustomizeAgent[],
): CustomizeInstalledItem[] {
  return [
    ...buildInstalledMcpRows(servers).map(({ server, entry }) => ({
      id: `mcp${INSTALLED_ITEM_SEPARATOR}${server.id}`,
      section: "mcp" as const,
      label: entry && entry.id === server.name.toLowerCase() ? entry.name : server.name,
      brand: entry?.brand,
    })),
    ...agents
      .filter((agent) => agent.isInstalled)
      .map((agent) => ({
        id: `agents${INSTALLED_ITEM_SEPARATOR}${agent.id}`,
        section: "agents" as const,
        label: agent.name,
        brand: agent.brand,
      })),
  ];
}

const SECTIONS = new Set<string>(["mcp", "agents", "skills", "extensions"]);

/** Reads a navigation value: a section, or an installed item inside one. */
export function parseCustomizeNavigationValue(
  value: string,
): { section: CustomizeSection; itemId?: string } | null {
  const separator = value.indexOf(INSTALLED_ITEM_SEPARATOR);
  const section = separator === -1 ? value : value.slice(0, separator);
  if (!SECTIONS.has(section)) return null;
  return separator === -1
    ? { section: section as CustomizeSection }
    : { section: section as CustomizeSection, itemId: value.slice(separator + 1) };
}
