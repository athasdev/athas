import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GENERATED_CDN_DIR,
  getContributionArray,
  getExtensionCdnPath,
  getExtensionSourceDir,
  listExtensionFolders,
} from "./extension-workspace";

type ExtensionManifest = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  publisher?: string;
  categories?: string[];
  installation?: {
    size?: number;
    platformArch?: Record<string, { size?: number }>;
  };
  contributes?: Record<string, unknown>;
  [key: string]: unknown;
};

type RegistryEntry = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  publisher: string;
  category: string;
  icon: string;
  downloads: number;
  rating: number;
  manifestUrl: string;
  size?: number;
};

type RegistryFile = {
  version: string;
  lastUpdated: string;
  extensions: RegistryEntry[];
};

type IndexEntry = {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: "Languages" | "Themes" | "Icon Themes" | "Databases" | "Agents";
  icon: string;
  manifestUrl: string;
  downloads: number;
  rating: number;
  size?: number;
};

const registryPath = join(GENERATED_CDN_DIR, "registry.json");
const indexPath = join(GENERATED_CDN_DIR, "index.json");
const cdnBaseUrl = process.env.EXTENSIONS_CDN_BASE_URL || "https://athas.dev/extensions";
const checkOnly = process.argv.includes("--check");

function normalizeIndexCategory(raw?: string): IndexEntry["category"] {
  const value = (raw ?? "").toLowerCase().replace(/[_-]+/g, " ").trim();

  if (value === "icon" || value === "icon theme" || value === "icon themes") return "Icon Themes";
  if (value === "database" || value === "databases") return "Databases";
  if (value === "agent" || value === "agents") return "Agents";
  if (value === "theme" || value === "themes") return "Themes";
  return "Languages";
}

function normalizeRegistryCategory(raw?: string): string {
  const normalized = (raw ?? "").toLowerCase();
  if (normalized.includes("icon")) return "icon-theme";
  if (normalized.includes("database")) return "database";
  if (normalized.includes("agent")) return "agent";
  if (normalized.includes("theme")) return "theme";
  return "language";
}

function resolveInstallSize(manifest: ExtensionManifest): number | undefined {
  const platformSizes = Object.values(manifest.installation?.platformArch ?? {})
    .map((entry) => entry.size)
    .filter((size): size is number => typeof size === "number" && size > 0);

  if (platformSizes.length > 0) {
    return Math.min(...platformSizes);
  }

  const size = manifest.installation?.size;
  return typeof size === "number" && size > 0 ? size : undefined;
}

function withTrailingNewline(json: unknown): string {
  return `${JSON.stringify(json, null, 2)}\n`;
}

async function buildCatalog() {
  const folders = await listExtensionFolders();
  const registryEntries: RegistryEntry[] = [];
  const languageOwners = new Map<string, string>();

  for (const folder of folders) {
    const manifestPath = join(getExtensionSourceDir(folder), "extension.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ExtensionManifest;

    if (!manifest.id) {
      throw new Error(`Missing id in ${manifestPath}`);
    }

    const languages = getContributionArray(manifest, "languages");
    const databases = getContributionArray(manifest, "databases");
    const agents = getContributionArray(manifest, "agents");
    const themes = getContributionArray(manifest, "themes");
    const icons = getContributionArray(manifest, "icons");

    if (
      languages.length === 0 &&
      databases.length === 0 &&
      agents.length === 0 &&
      themes.length === 0 &&
      icons.length === 0
    ) {
      throw new Error(`No extension contributions declared in ${manifestPath}`);
    }

    for (const language of languages) {
      if (typeof language.id !== "string") continue;
      if (languageOwners.has(language.id)) {
        throw new Error(
          `Duplicate language id "${language.id}" in ${manifest.id} and ${languageOwners.get(language.id)}`,
        );
      }
      languageOwners.set(language.id, manifest.id);
    }

    const rawCategory = manifest.categories?.[0];
    const registryCategory = normalizeRegistryCategory(rawCategory);
    const displayName = manifest.displayName || manifest.name;
    const isLanguage = registryCategory === "language";
    const cdnPath = getExtensionCdnPath(folder, manifest);

    registryEntries.push({
      id: manifest.id,
      name: manifest.name,
      displayName:
        isLanguage && !displayName.toLowerCase().includes("support")
          ? `${displayName} Language Support`
          : displayName,
      description: manifest.description || `${displayName} ${registryCategory} extension`,
      version: manifest.version || "1.0.0",
      publisher: manifest.publisher || "Athas",
      category: registryCategory,
      icon: `${cdnBaseUrl}/${cdnPath}/icon.svg`,
      downloads: 0,
      rating: 0,
      manifestUrl: `${cdnBaseUrl}/${cdnPath}/extension.json`,
      size: resolveInstallSize(manifest),
    });
  }

  let lastUpdated = new Date().toISOString();
  try {
    const existingRegistry = JSON.parse(await readFile(registryPath, "utf8")) as RegistryFile;
    if (
      Array.isArray(existingRegistry.extensions) &&
      JSON.stringify(existingRegistry.extensions) === JSON.stringify(registryEntries) &&
      existingRegistry.lastUpdated
    ) {
      lastUpdated = existingRegistry.lastUpdated;
    }
  } catch {
    // No existing generated registry; keep a fresh timestamp.
  }

  const registryFile: RegistryFile = {
    version: "1.0.0",
    lastUpdated,
    extensions: registryEntries,
  };

  const indexEntries: IndexEntry[] = registryEntries.map((entry) => ({
    id: entry.id,
    name: entry.displayName || entry.name || entry.id,
    description: entry.description,
    version: entry.version,
    author: entry.publisher,
    category: normalizeIndexCategory(entry.category),
    icon: entry.icon,
    manifestUrl: entry.manifestUrl,
    downloads: entry.downloads,
    rating: entry.rating,
    size: entry.size,
  }));

  return {
    registryOutput: withTrailingNewline(registryFile),
    indexOutput: withTrailingNewline(indexEntries),
    count: registryEntries.length,
  };
}

const { registryOutput, indexOutput, count } = await buildCatalog();

if (checkOnly) {
  const currentRegistry = await readFile(registryPath, "utf8").catch(() => "");
  const currentIndex = await readFile(indexPath, "utf8").catch(() => "");

  if (currentRegistry !== registryOutput || currentIndex !== indexOutput) {
    console.error(
      "Extensions catalog is out of date. Run `bun src/features/extensions/scripts/build-extensions-index.ts`.",
    );
    process.exit(1);
  }

  console.log(`Extensions catalog check passed (${count} extensions).`);
  process.exit(0);
}

await mkdir(GENERATED_CDN_DIR, { recursive: true });
await writeFile(registryPath, registryOutput, "utf8");
await writeFile(indexPath, indexOutput, "utf8");

console.log(`Wrote extensions catalog (${count} extensions).`);
console.log(`- ${registryPath}`);
console.log(`- ${indexPath}`);
