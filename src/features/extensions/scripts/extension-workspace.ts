import { $ } from "bun";
import { readdir } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

export type ExtensionManifestRecord = Record<string, unknown>;

export const FEATURE_ROOT = resolve(import.meta.dirname, "..");
export const ATHAS_ROOT = resolve(FEATURE_ROOT, "../../..");
export const EXTENSIONS_ROOT = join(ATHAS_ROOT, "extensions");
export const GENERATED_CDN_DIR = join(EXTENSIONS_ROOT, "generated", "cdn");
export const CATALOG_DIR = join(FEATURE_ROOT, "catalog");

const CONTRIBUTION_ALIASES: Record<string, string[]> = {
  databases: ["databases", "databaseProviders"],
  databaseProviders: ["databases", "databaseProviders"],
  icons: ["icons", "iconThemes"],
  iconThemes: ["icons", "iconThemes"],
};

function contributionKeys(key: string): string[] {
  return CONTRIBUTION_ALIASES[key] ?? [key];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getContributionArray(
  manifest: ExtensionManifestRecord,
  key: string,
): Array<Record<string, unknown>> {
  const contributes = objectRecord(manifest.contributes);
  const items: Array<Record<string, unknown>> = [];

  for (const contributionKey of contributionKeys(key)) {
    const topLevel = manifest[contributionKey];
    const contributed = contributes[contributionKey];

    if (Array.isArray(topLevel)) {
      items.push(...(topLevel as Array<Record<string, unknown>>));
    }

    if (Array.isArray(contributed)) {
      items.push(...(contributed as Array<Record<string, unknown>>));
    }
  }

  return items;
}

export async function listExtensionFolders(): Promise<string[]> {
  const folders: string[] = [];

  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });

    if (entries.some((entry) => entry.isFile() && entry.name === "extension.json")) {
      folders.push(relative(EXTENSIONS_ROOT, directory));
      return;
    }

    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name !== "generated" &&
            entry.name !== "node_modules" &&
            entry.name !== "packages",
        )
        .map((entry) => walk(join(directory, entry.name))),
    );
  }

  await walk(EXTENSIONS_ROOT);
  return folders.sort((a, b) => a.localeCompare(b));
}

export function getExtensionSourceDir(folder: string): string {
  return join(EXTENSIONS_ROOT, folder);
}

export function getExtensionCdnPath(folder: string, manifest: ExtensionManifestRecord): string {
  const slug = basename(folder);
  const databases = getContributionArray(manifest, "databases");
  const agents = getContributionArray(manifest, "agents");
  const themes = getContributionArray(manifest, "themes");
  const icons = getContributionArray(manifest, "icons");

  if (databases.length > 0 && typeof databases[0].id === "string") {
    return `database/${databases[0].id}`;
  }

  if (agents.length > 0 && typeof agents[0].id === "string") {
    return `agents/${agents[0].id}`;
  }

  if (icons.length > 0) {
    const iconSlug = slug.startsWith("icons-") ? slug.slice("icons-".length) : String(icons[0].id);
    return `icon-theme/${iconSlug}`;
  }

  if (themes.length > 0) {
    const themeSlug = slug.startsWith("theme-")
      ? slug.slice("theme-".length)
      : String(themes[0].id);
    return `theme/${themeSlug}`;
  }

  return slug;
}

export function getGeneratedCdnPath(relativePath = ""): string {
  return join(GENERATED_CDN_DIR, relativePath);
}

export async function writeExtensionManifest(
  manifestPath: string,
  manifest: ExtensionManifestRecord,
) {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await $`bunx vp check --fix ${manifestPath}`.cwd(ATHAS_ROOT);
}
