import { getDatabaseBrandImage } from "@/ui/brand-marks";
import type { CustomizeBrand, McpCatalogEntry, McpCatalogGroup } from "../types/customize.types";

const postgresImage = getDatabaseBrandImage("postgres");
const postgresBrand: CustomizeBrand | undefined = postgresImage
  ? { kind: "image", src: postgresImage }
  : undefined;

export const MCP_CATALOG_GROUPS: ReadonlyArray<{ id: McpCatalogGroup; label: string }> = [
  { id: "popular", label: "Popular" },
  { id: "developer", label: "Developer tools" },
  { id: "work", label: "Work and planning" },
  { id: "data", label: "Data and research" },
];

/**
 * MCP servers Athas suggests, with the configuration their publishers document. Remote servers
 * that sign in with OAuth need no secrets here; the rest name the variable or header to fill.
 */
export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repositories, issues, pull requests and Actions",
    group: "popular",
    brand: { kind: "github" },
    setupNote: "Set Authorization to Bearer followed by a GitHub personal access token.",
    config: {
      transport: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: ["Authorization"],
    },
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issues, projects and cycles in your Linear workspace",
    group: "popular",
    config: { transport: "http", url: "https://mcp.linear.app/mcp" },
  },
  {
    id: "figma",
    name: "Figma",
    description: "Design context from Figma files, frames and components",
    group: "popular",
    config: { transport: "http", url: "https://mcp.figma.com/mcp" },
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Errors, issues and releases from Sentry",
    group: "popular",
    config: { transport: "http", url: "https://mcp.sentry.dev/mcp" },
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Drive a real browser to open, click and read pages",
    group: "popular",
    config: { transport: "stdio", command: "npx", args: ["@playwright/mcp@latest"] },
  },
  {
    id: "context7",
    name: "Context7",
    description: "Current library documentation and code examples",
    group: "popular",
    config: { transport: "stdio", command: "npx", args: ["-y", "@upstash/context7-mcp"] },
  },
  {
    id: "chrome-devtools",
    name: "Chrome DevTools",
    description: "Inspect, debug and profile pages in Chrome",
    group: "developer",
    config: { transport: "stdio", command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] },
  },
  {
    id: "git",
    name: "Git",
    description: "Read, search and change a local Git repository",
    group: "developer",
    config: { transport: "stdio", command: "uvx", args: ["mcp-server-git"] },
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read and write files in the folders you allow",
    group: "developer",
    setupNote: "The last argument is the folder the server may use. Add a line for each folder.",
    config: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Projects, deployments and build logs on Vercel",
    group: "developer",
    config: { transport: "http", url: "https://mcp.vercel.com" },
  },
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    description: "Search the Cloudflare developer documentation",
    group: "developer",
    config: { transport: "http", url: "https://docs.mcp.cloudflare.com/mcp" },
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Databases, auth and edge functions in Supabase",
    group: "developer",
    setupNote: "Set SUPABASE_ACCESS_TOKEN to a Supabase personal access token.",
    config: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@supabase/mcp-server-supabase@latest"],
      env: ["SUPABASE_ACCESS_TOKEN"],
    },
  },
  {
    id: "notion",
    name: "Notion",
    description: "Pages, databases and comments in Notion",
    group: "work",
    config: { transport: "http", url: "https://mcp.notion.com/mcp" },
  },
  {
    id: "slack",
    name: "Slack",
    description: "Channels, threads and messages in Slack",
    group: "work",
    setupNote: "Set SLACK_MCP_XOXP_TOKEN to a Slack user token.",
    config: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "slack-mcp-server@latest", "--transport", "stdio"],
      env: ["SLACK_MCP_XOXP_TOKEN"],
    },
  },
  {
    id: "atlassian",
    name: "Atlassian",
    description: "Jira issues and Confluence pages",
    group: "work",
    config: { transport: "sse", url: "https://mcp.atlassian.com/v1/sse" },
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Customers, payments and the Stripe docs",
    group: "work",
    config: { transport: "http", url: "https://mcp.stripe.com" },
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "Query and inspect a PostgreSQL database",
    group: "data",
    brand: postgresBrand,
    setupNote: "Set DATABASE_URI to the connection string. Restricted mode keeps it read-only.",
    config: {
      transport: "stdio",
      command: "uvx",
      args: ["postgres-mcp", "--access-mode=restricted"],
      env: ["DATABASE_URI"],
    },
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch web pages and read them as Markdown",
    group: "data",
    config: { transport: "stdio", command: "uvx", args: ["mcp-server-fetch"] },
  },
  {
    id: "memory",
    name: "Memory",
    description: "A local knowledge graph agents keep facts in",
    group: "data",
    config: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    },
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Work through a problem in revisable steps",
    group: "data",
    config: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    },
  },
  {
    id: "hugging-face",
    name: "Hugging Face",
    description: "Models, datasets and Spaces on the Hugging Face Hub",
    group: "data",
    config: { transport: "http", url: "https://huggingface.co/mcp" },
  },
];
