import type { McpTransport } from "@/features/ai/types/mcp-server.types";

/** The pages of Customize, in the order its navigation lists them. */
export type CustomizeSection = "mcp" | "agents" | "skills" | "extensions";

/** What a Customize page lists: everything that can be added, or what is already set up. */
export type CustomizeTab = "catalog" | "installed";

/** Third-party art a catalog row can show instead of a letter. */
export type CustomizeBrand =
  | { kind: "image"; src: string }
  | { kind: "github" }
  | { kind: "provider"; providerId: string; iconUrl?: string | null };

/** The group a catalog MCP server is listed under. */
export type McpCatalogGroup = "popular" | "developer" | "work" | "data";

/**
 * A known MCP server the user can add. `config` fills the add-server dialog; names in `env` and
 * `headers` start empty because their values are the user's own secrets.
 */
export interface McpCatalogEntry {
  /** Lowercase server name the agents see, and how an installed server is recognised. */
  id: string;
  name: string;
  description: string;
  group: McpCatalogGroup;
  brand?: CustomizeBrand;
  /** What the user still has to fill in before the server works. */
  setupNote?: string;
  config:
    | { transport: "stdio"; command: string; args: string[]; env?: string[] }
    | { transport: Exclude<McpTransport, "stdio">; url: string; headers?: string[] };
}

/** An agent as Customize lists it: an ACP agent from the catalog, or the Codex integration. */
export interface CustomizeAgent {
  id: string;
  name: string;
  description: string;
  brand?: CustomizeBrand;
  isInstalled: boolean;
  canInstall: boolean;
  updateAvailable: boolean;
  /** Athas ships it, rather than only the ACP Registry listing it. */
  isFeatured: boolean;
  /** Why it cannot be installed from here, when it cannot. */
  unavailableReason?: string;
  isCodex: boolean;
}

/** An entry of the navigation's Installed group. */
export interface CustomizeInstalledItem {
  id: string;
  section: CustomizeSection;
  label: string;
  brand?: CustomizeBrand;
}
