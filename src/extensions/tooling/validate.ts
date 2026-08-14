/**
 * Validate extension source manifests and generated catalog files.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { validateExtensionPackageContract } from "../manifest/extension-package-contract";
import {
  GENERATED_CDN_DIR,
  getContributionArray,
  getExtensionCdnPath,
  getExtensionSourceDir,
  getReservedBuiltInThemeContribution,
  inspectExtensionPackageLayout,
  listExtensionFolders,
  readDeployableExtensionManifest,
  readExtensionArtifacts,
  readExtensionSourceManifest,
} from "./extension-workspace";

interface ValidationError {
  extension: string;
  message: string;
}

const verifyLocalPackages = process.argv.includes("--verify-local-packages");
const verifyAgentRegistry = process.argv.includes("--verify-agent-registry");
const errors: ValidationError[] = [];
const warnings: ValidationError[] = [];
const validToolRuntimes = new Set([
  "bun",
  "node",
  "python",
  "go",
  "rust",
  "ruby",
  "r",
  "system",
  "binary",
]);
const knownBinaryInstallStrategyTools = new Set([
  "clangd",
  "dart",
  "elixir-ls",
  "jdtls",
  "kotlin-language-server",
  "lua-language-server",
  "marksman",
  "omnisharp",
  "rust-analyzer",
  "stylua",
  "terraform-ls",
  "zig",
  "zls",
]);
const knownRuntimeRewriteTools = new Set([
  "elm-language-server",
  "rescript-language-server",
  "solargraph",
  "solidity-language-server",
]);
const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const ACP_REGISTRY_AGENT_ALIASES: Record<string, string> = {
  "gemini-cli": "gemini",
  "kimi-cli": "kimi",
};

function error(extension: string, message: string) {
  errors.push({ extension, message });
}

function warn(extension: string, message: string) {
  warnings.push({ extension, message });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function validatePackageEntry(
  folder: string,
  label: string,
  packageEntry: { downloadUrl?: unknown; size?: unknown; checksum?: unknown },
): Promise<void> {
  if (typeof packageEntry.downloadUrl !== "string" || packageEntry.downloadUrl.length === 0) {
    error(folder, `${label} missing 'downloadUrl'`);
    return;
  }

  if (typeof packageEntry.size !== "number" || packageEntry.size <= 0) {
    error(folder, `${label} missing positive 'size'`);
  }

  if (typeof packageEntry.checksum !== "string" || packageEntry.checksum.length === 0) {
    error(folder, `${label} missing 'checksum'`);
  }

  if (!verifyLocalPackages) return;

  const packagePathMatch = packageEntry.downloadUrl.match(/\/extensions\/(.+)$/);
  if (!packagePathMatch) {
    error(
      folder,
      `${label} downloadUrl must point under /extensions/: ${packageEntry.downloadUrl}`,
    );
    return;
  }

  const packagePath = join(GENERATED_CDN_DIR, packagePathMatch[1]);
  if (!(await fileExists(packagePath))) {
    error(folder, `Installation package not found: ${packagePathMatch[1]}`);
    return;
  }

  const packageStats = await stat(packagePath);
  if (typeof packageEntry.size === "number" && packageStats.size !== packageEntry.size) {
    error(
      folder,
      `${label} size mismatch: expected ${packageEntry.size}, got ${packageStats.size}`,
    );
  }

  if (typeof packageEntry.checksum === "string" && packageEntry.checksum.length > 0) {
    const actualChecksum = await sha256(packagePath);
    if (actualChecksum !== packageEntry.checksum) {
      error(
        folder,
        `${label} checksum mismatch: expected ${packageEntry.checksum}, got ${actualChecksum}`,
      );
    }
  }
}

async function validateInstallPackage(
  folder: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  const installation = manifest.installation as
    | {
        downloadUrl?: unknown;
        size?: unknown;
        checksum?: unknown;
        platformArch?: unknown;
      }
    | undefined;
  const requiresPackage =
    getContributionArray(manifest, "databases").length > 0 ||
    getContributionArray(manifest, "themes").length > 0 ||
    getContributionArray(manifest, "icons").length > 0 ||
    getContributionArray(manifest, "integrations").length > 0;

  if (!requiresPackage) return;

  if (!installation) {
    error(folder, "Installable extension missing 'installation' metadata");
    return;
  }

  await validatePackageEntry(folder, "Installation metadata", installation);

  if (installation.platformArch === undefined) return;

  if (
    typeof installation.platformArch !== "object" ||
    installation.platformArch === null ||
    Array.isArray(installation.platformArch)
  ) {
    error(folder, "Installation metadata 'platformArch' must be an object");
    return;
  }

  for (const [platformArch, packageEntry] of Object.entries(installation.platformArch)) {
    if (typeof packageEntry !== "object" || packageEntry === null || Array.isArray(packageEntry)) {
      error(folder, `Installation package for ${platformArch} must be an object`);
      continue;
    }

    await validatePackageEntry(
      folder,
      `Installation package for ${platformArch}`,
      packageEntry as {
        downloadUrl?: unknown;
        size?: unknown;
        checksum?: unknown;
      },
    );
  }
}

function validateLanguageToolConfig(folder: string, label: string, toolConfig: unknown): void {
  if (!toolConfig || typeof toolConfig !== "object" || Array.isArray(toolConfig)) {
    return;
  }

  const tool = toolConfig as {
    name?: unknown;
    runtime?: unknown;
    downloadUrl?: unknown;
  };
  const name = typeof tool.name === "string" ? tool.name : undefined;
  const runtime = typeof tool.runtime === "string" ? tool.runtime : undefined;

  if (!name) {
    error(folder, `${label} tool missing 'name'`);
    return;
  }

  if (!runtime) {
    error(folder, `${label} tool '${name}' missing 'runtime'`);
    return;
  }

  if (!validToolRuntimes.has(runtime)) {
    error(folder, `${label} tool '${name}' has invalid runtime '${runtime}'`);
    return;
  }

  if (runtime === "system" && tool.downloadUrl !== undefined) {
    error(folder, `${label} system tool '${name}' must not declare 'downloadUrl'`);
  }

  if (
    runtime === "binary" &&
    typeof tool.downloadUrl !== "string" &&
    !knownBinaryInstallStrategyTools.has(name) &&
    !knownRuntimeRewriteTools.has(name)
  ) {
    error(
      folder,
      `${label} binary tool '${name}' needs 'downloadUrl', a known install strategy, or runtime 'system'`,
    );
  }
}

function validateLanguageToolConfigs(folder: string, manifest: Record<string, unknown>): void {
  const capabilities =
    typeof manifest.capabilities === "object" && manifest.capabilities !== null
      ? (manifest.capabilities as Record<string, unknown>)
      : {};

  validateLanguageToolConfig(folder, "LSP", capabilities.lsp);
  validateLanguageToolConfig(folder, "Formatter", capabilities.formatter);
  validateLanguageToolConfig(folder, "Linter", capabilities.linter);
}

async function validateExtension(folder: string): Promise<void> {
  const extensionDir = getExtensionSourceDir(folder);
  const manifestPath = join(extensionDir, "extension.json");

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (e) {
    error(folder, `Invalid JSON in extension.json: ${e}`);
    return;
  }

  for (const issue of validateExtensionPackageContract(manifest)) {
    error(folder, `${issue.path}: ${issue.message}`);
  }

  const contributionCount =
    getContributionArray(manifest, "languages").length +
    getContributionArray(manifest, "databases").length +
    getContributionArray(manifest, "agents").length +
    getContributionArray(manifest, "themes").length +
    getContributionArray(manifest, "icons").length +
    getContributionArray(manifest, "integrations").length;

  if (contributionCount === 0) {
    error(folder, "Extension must declare at least one contribution");
  }

  for (const lang of getContributionArray(manifest, "languages")) {
    if (!lang.id) error(folder, "Language entry missing 'id'");
    const hasExtensionMatcher =
      Array.isArray(lang.extensions) ||
      Array.isArray(lang.filenames) ||
      Array.isArray(lang.filenamePatterns);
    if (!hasExtensionMatcher) {
      error(
        folder,
        `Language '${lang.id}' missing one of 'extensions', 'filenames', or 'filenamePatterns'`,
      );
    }
  }

  for (const provider of getContributionArray(manifest, "databases")) {
    if (!provider.id) error(folder, "Database entry missing 'id'");
    if (!provider.protocolVersion) {
      error(folder, `Database '${provider.id}' missing 'protocolVersion'`);
    }
    if (!provider.sidecar || typeof provider.sidecar !== "object") {
      error(folder, `Database '${provider.id}' missing 'sidecar' map`);
    }
  }

  for (const agent of getContributionArray(manifest, "agents")) {
    if (!agent.id) error(folder, "Agent contribution missing 'id'");
    if (!agent.name) error(folder, `Agent '${agent.id}' missing 'name'`);
    if (!agent.binaryName) error(folder, `Agent '${agent.id}' missing 'binaryName'`);

    const install = agent.install as Record<string, unknown> | undefined;
    if (install) {
      if (!install.runtime) error(folder, `Agent '${agent.id}' install missing 'runtime'`);
      if (!install.package) error(folder, `Agent '${agent.id}' install missing 'package'`);
      if (!install.command) error(folder, `Agent '${agent.id}' install missing 'command'`);
    }
  }

  for (const theme of getContributionArray(manifest, "themes")) {
    if (!theme.id) error(folder, "Theme contribution missing 'id'");
    if (!theme.name) error(folder, `Theme '${theme.id}' missing 'name'`);
    const reservedTheme = getReservedBuiltInThemeContribution(theme);
    if (reservedTheme) {
      error(
        folder,
        `Theme '${theme.id}' uses reserved built-in Athas theme identity '${reservedTheme.name || reservedTheme.id}'`,
      );
    }
    if (theme.appearance !== "dark" && theme.appearance !== "light") {
      error(folder, `Theme '${theme.id}' has invalid 'appearance'`);
    }
    if (!theme.colors || typeof theme.colors !== "object") {
      error(folder, `Theme '${theme.id}' missing 'colors' map`);
    }
  }

  for (const icon of getContributionArray(manifest, "icons")) {
    if (!icon.id) error(folder, "Icon contribution missing 'id'");
    if (!icon.name) error(folder, `Icon '${icon.id}' missing 'name'`);
    if (!icon.iconDefinitions || typeof icon.iconDefinitions !== "object") {
      error(folder, `Icon '${icon.id}' missing 'iconDefinitions' map`);
    }
  }

  const integrations = getContributionArray(manifest, "integrations");
  for (const integration of integrations) {
    if (!integration.id) error(folder, "Integration contribution missing 'id'");
    if (!integration.name) error(folder, `Integration '${integration.id}' missing 'name'`);
    if (
      !["code-host", "observability", "project-management", "other"].includes(
        String(integration.kind),
      )
    ) {
      error(folder, `Integration '${integration.id}' has invalid 'kind'`);
    }
  }
  if (integrations.length > 0) {
    if (typeof manifest.main !== "string" || manifest.main.length === 0) {
      error(folder, "Integration extension missing 'main' entrypoint");
    } else if (
      isAbsolute(manifest.main) ||
      manifest.main.split(/[\\/]/).some((segment) => segment === "..")
    ) {
      error(folder, "Integration extension 'main' must be a safe relative path");
    } else if (!(await fileExists(join(extensionDir, manifest.main)))) {
      error(folder, `Integration entrypoint not found: ${manifest.main}`);
    }

    const permissions = manifest.permissions;
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
      error(folder, "Integration extension must declare a 'permissions' object");
    } else {
      const permissionRecord = permissions as Record<string, unknown>;
      const supportedPermissions = new Set(["network", "secrets", "workspace", "openExternal"]);
      for (const key of Object.keys(permissionRecord)) {
        if (!supportedPermissions.has(key)) error(folder, `Unsupported permission '${key}'`);
      }
      if (
        permissionRecord.network !== undefined &&
        (!Array.isArray(permissionRecord.network) ||
          permissionRecord.network.some(
            (origin) => typeof origin !== "string" || !/^https?:\/\/[^/]+\/?$/.test(origin),
          ))
      ) {
        error(folder, "Integration 'network' permission must contain HTTP origin patterns");
      }
      if (permissionRecord.secrets !== undefined && typeof permissionRecord.secrets !== "boolean") {
        error(folder, "Integration 'secrets' permission must be boolean");
      }
      if (permissionRecord.workspace !== undefined && permissionRecord.workspace !== "read") {
        error(folder, "Integration 'workspace' permission must be 'read'");
      }
      if (
        permissionRecord.openExternal !== undefined &&
        typeof permissionRecord.openExternal !== "boolean"
      ) {
        error(folder, "Integration 'openExternal' permission must be boolean");
      }
    }
  }

  if (manifest.installation !== undefined) {
    error(folder, "Source manifest must keep installation metadata in extensions/artifacts.json");
  }
  validateLanguageToolConfigs(folder, manifest);

  const capabilities = manifest.capabilities as Record<string, unknown> | undefined;
  if (capabilities?.grammar) {
    const grammar = capabilities.grammar as Record<string, string>;
    if (grammar.wasmPath && !(await fileExists(join(extensionDir, grammar.wasmPath)))) {
      warn(folder, `Grammar wasmPath not in repo (expected on CDN): ${grammar.wasmPath}`);
    }
    if (grammar.highlightQuery && !(await fileExists(join(extensionDir, grammar.highlightQuery)))) {
      warn(folder, `Highlight query file not found: ${grammar.highlightQuery}`);
    }
  }
}

async function validateJsonFile(name: string, expectedShape: "array" | "object"): Promise<void> {
  const filePath = join(GENERATED_CDN_DIR, name);
  if (!(await fileExists(filePath))) {
    error(name, `Missing generated ${name}`);
    return;
  }

  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    if (expectedShape === "array" && !Array.isArray(value)) {
      error(name, `${name} should be an array`);
    }
    if (
      expectedShape === "object" &&
      (typeof value !== "object" || value === null || Array.isArray(value))
    ) {
      error(name, `${name} should be an object`);
    }
  } catch (e) {
    error(name, `Invalid JSON: ${e}`);
  }
}

async function listGeneratedExtensionManifests(directory: string): Promise<string[]> {
  if (!(await fileExists(directory))) return [];

  const manifests: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...(await listGeneratedExtensionManifests(entryPath)));
    } else if (entry.isFile() && entry.name === "extension.json") {
      manifests.push(relative(GENERATED_CDN_DIR, entryPath));
    }
  }

  return manifests;
}

async function validateGeneratedExtensionPaths(extensionFolders: string[]): Promise<void> {
  const expectedPaths = new Set<string>();
  const artifacts = await readExtensionArtifacts();

  for (const folder of extensionFolders) {
    const sourceManifest = await readExtensionSourceManifest(folder);
    const manifest = await readDeployableExtensionManifest(folder, artifacts);
    expectedPaths.add(join(getExtensionCdnPath(folder, manifest), "extension.json"));
    await validateInstallPackage(folder, manifest);

    const generatedManifestPath = join(
      GENERATED_CDN_DIR,
      getExtensionCdnPath(folder, sourceManifest),
      "extension.json",
    );
    if (await fileExists(generatedManifestPath)) {
      const generatedManifest = JSON.parse(await readFile(generatedManifestPath, "utf8")) as Record<
        string,
        unknown
      >;
      if (JSON.stringify(generatedManifest) !== JSON.stringify(manifest)) {
        error(folder, "Generated manifest is out of date with source manifest and artifacts");
      }
    }
  }

  const generatedPaths = new Set(await listGeneratedExtensionManifests(GENERATED_CDN_DIR));
  for (const generatedPath of generatedPaths) {
    if (!expectedPaths.has(generatedPath)) {
      error("generated CDN", `Orphaned extension manifest '${generatedPath}'`);
    }
  }

  for (const expectedPath of expectedPaths) {
    if (!generatedPaths.has(expectedPath)) {
      error("generated CDN", `Missing extension manifest '${expectedPath}'`);
    }
  }
}

function packageIdentity(packageSpec: string): string {
  const versionSeparator = packageSpec.lastIndexOf("@");
  return versionSeparator > 0 ? packageSpec.slice(0, versionSeparator) : packageSpec;
}

async function validateAgentsAgainstAcpRegistry(extensionFolders: string[]): Promise<void> {
  try {
    const response = await fetch(ACP_REGISTRY_URL);
    if (!response.ok) {
      error("ACP Registry", `Registry request failed with HTTP ${response.status}`);
      return;
    }

    const registry = (await response.json()) as {
      agents?: Array<{
        id: string;
        version: string;
        distribution?: {
          npx?: { package?: string; args?: string[] };
          binary?: Record<string, { args?: string[] }>;
        };
      }>;
    };
    const registryAgents = new Map((registry.agents ?? []).map((agent) => [agent.id, agent]));

    for (const folder of extensionFolders) {
      const manifestPath = join(getExtensionSourceDir(folder), "extension.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;

      for (const agent of getContributionArray(manifest, "agents")) {
        const agentId = String(agent.id);
        const registryId = ACP_REGISTRY_AGENT_ALIASES[agentId] ?? agentId;
        const registryAgent = registryAgents.get(registryId);
        if (!registryAgent) {
          error(folder, `Agent '${agentId}' is not present in the official ACP Registry`);
          continue;
        }

        const install = agent.install as Record<string, unknown> | undefined;
        const packageName = typeof install?.package === "string" ? install.package : undefined;
        const registryPackage = registryAgent.distribution?.npx?.package;
        if (
          packageName &&
          registryPackage &&
          packageIdentity(packageName) !== packageIdentity(registryPackage)
        ) {
          error(
            folder,
            `Agent '${agentId}' installs '${packageName}', but the ACP Registry uses '${registryPackage}'`,
          );
        }

        const configuredArgs = Array.isArray(agent.args) ? agent.args : [];
        const registryArgs =
          registryAgent.distribution?.npx?.args ??
          Object.values(registryAgent.distribution?.binary ?? {}).find((entry) => entry.args)
            ?.args ??
          [];
        if (JSON.stringify(configuredArgs) !== JSON.stringify(registryArgs)) {
          error(
            folder,
            `Agent '${agentId}' uses args ${JSON.stringify(configuredArgs)}, but the ACP Registry uses ${JSON.stringify(registryArgs)}`,
          );
        }

        if (install?.runtime === "binary") {
          const downloadUrls = Object.values(
            (install.downloadUrls as Record<string, unknown> | undefined) ?? {},
          ).filter((url): url is string => typeof url === "string");
          if (
            downloadUrls.length === 0 ||
            downloadUrls.some((url) => !url.includes(`/${registryAgent.version}/`))
          ) {
            error(
              folder,
              `Agent '${agentId}' binary URLs do not use ACP Registry version ${registryAgent.version}`,
            );
          }
        }
      }
    }
  } catch (registryError) {
    error(
      "ACP Registry",
      registryError instanceof Error ? registryError.message : String(registryError),
    );
  }
}

console.log("Validating extensions...\n");

for (const issue of await inspectExtensionPackageLayout()) {
  error(issue.folder, issue.message);
}

const extensionFolders = await listExtensionFolders();
console.log(`Found ${extensionFolders.length} extensions\n`);

await Promise.all(extensionFolders.map(validateExtension));
await validateGeneratedExtensionPaths(extensionFolders);
if (verifyAgentRegistry) {
  await validateAgentsAgainstAcpRegistry(extensionFolders);
}
await validateJsonFile("registry.json", "object");
await validateJsonFile("index.json", "array");
await validateJsonFile("manifests.json", "object");

if (warnings.length > 0) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const w of warnings) {
    console.log(`  [${w.extension}] ${w.message}`);
  }
}

if (errors.length > 0) {
  console.log(`\nErrors (${errors.length}):`);
  for (const e of errors) {
    console.error(`  [${e.extension}] ${e.message}`);
  }
  process.exit(1);
}

console.log("\nAll extensions valid!");
