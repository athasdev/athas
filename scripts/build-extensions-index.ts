import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type ExternalLanguageManifest = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  publisher?: string;
  categories?: string[];
  languages?: Array<{
    id: string;
    extensions: string[];
  }>;
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
  category: "Languages" | "Themes" | "Icon Themes";
  icon: string;
  manifestUrl: string;
  downloads: number;
  rating: number;
};

const root = process.cwd();
const extensionsRoot = join(root, "extensions");
const registryPath = join(extensionsRoot, "registry.json");
const indexPath = join(extensionsRoot, "index.json");
const cdnBaseUrl = process.env.EXTENSIONS_CDN_BASE_URL || "https://athas.dev/extensions";
const checkOnly = process.argv.includes("--check");

function normalizeIndexCategory(raw?: string): IndexEntry["category"] {
  const value = (raw ?? "").toLowerCase().replace(/[_-]+/g, " ").trim();

  if (value.includes("icon") && value.includes("theme")) return "Icon Themes";
  if (value === "icon" || value === "icon theme" || value === "icon themes") return "Icon Themes";
  if (value === "theme" || value === "themes") return "Themes";
  return "Languages";
}

function normalizeRegistryCategory(raw?: string): string {
  const normalized = (raw ?? "").toLowerCase();
  if (normalized.includes("icon") && normalized.includes("theme")) return "icon-theme";
  if (normalized.includes("theme")) return "theme";
  return "language";
}

function withTrailingNewline(json: unknown): string {
  return `${JSON.stringify(json, null, 2)}\n`;
}

async function listExtensionFolders(): Promise<string[]> {
  const entries = await readdir(extensionsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(extensionsRoot, name, "extension.json")))
    .sort((a, b) => a.localeCompare(b));
}

async function buildCatalog() {
  const folders = await listExtensionFolders();
  const registryEntries: RegistryEntry[] = [];
  const languageOwners = new Map<string, string>();

  for (const folder of folders) {
    const manifestPath = join(extensionsRoot, folder, "extension.json");
    const parserPath = join(extensionsRoot, folder, "parser.wasm");
    const highlightsPath = join(extensionsRoot, folder, "highlights.scm");
    const manifestRaw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw) as ExternalLanguageManifest;

    if (!manifest.id) {
      throw new Error(`Missing id in ${manifestPath}`);
    }

    const languages = manifest.languages ?? [];
    if (languages.length === 0) {
      throw new Error(`No languages declared in ${manifestPath}`);
    }

    if (!existsSync(parserPath)) {
      throw new Error(`Missing parser.wasm for ${manifest.id} (${parserPath})`);
    }

    if (!existsSync(highlightsPath)) {
      throw new Error(`Missing highlights.scm for ${manifest.id} (${highlightsPath})`);
    }

    for (const language of languages) {
      if (languageOwners.has(language.id)) {
        throw new Error(
          `Duplicate language id "${language.id}" in ${manifest.id} and ${languageOwners.get(language.id)}`,
        );
      }
      languageOwners.set(language.id, manifest.id);
    }

    const rawCategory = manifest.categories?.[0];
    const displayName = manifest.displayName || manifest.name;

    registryEntries.push({
      id: manifest.id,
      name: manifest.name,
      displayName: displayName.toLowerCase().includes("support")
        ? displayName
        : `${displayName} Language Support`,
      description: manifest.description || `${displayName} language support`,
      version: manifest.version || "1.0.0",
      publisher: manifest.publisher || "Athas",
      category: normalizeRegistryCategory(rawCategory),
      icon: `${cdnBaseUrl}/${folder}/icon.svg`,
      downloads: 0,
      rating: 0,
      manifestUrl: `${cdnBaseUrl}/${folder}/extension.json`,
    });
  }

  let lastUpdated = new Date().toISOString();
  try {
    const existingRegistryRaw = await readFile(registryPath, "utf8");
    const existingRegistry = JSON.parse(existingRegistryRaw) as RegistryFile;
    if (
      Array.isArray(existingRegistry.extensions) &&
      JSON.stringify(existingRegistry.extensions) === JSON.stringify(registryEntries) &&
      existingRegistry.lastUpdated
    ) {
      lastUpdated = existingRegistry.lastUpdated;
    }
  } catch {
    // No existing registry or parse failure; keep a fresh timestamp.
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
  const isRegistryUpToDate = currentRegistry === registryOutput;
  const isIndexUpToDate = currentIndex === indexOutput;

  if (!isRegistryUpToDate || !isIndexUpToDate) {
    console.error("Extensions catalog is out of date. Run `bun scripts/build-extensions-index.ts`.");
    process.exit(1);
  }

  console.log(`Extensions catalog check passed (${count} extensions).`);
  process.exit(0);
}

await writeFile(registryPath, registryOutput, "utf8");
await writeFile(indexPath, indexOutput, "utf8");

console.log(`Wrote extensions catalog (${count} extensions).`);
console.log(`- ${registryPath}`);
console.log(`- ${indexPath}`);
