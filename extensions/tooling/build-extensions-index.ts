import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SERVICE_DEFAULTS } from "@/config/service-defaults";
import { getIconThemePreviewDefinitions } from "@/extensions/icon-themes/icon-theme-preview";
import type { IconThemeContribution } from "@/extensions/types/extension-manifest";
import {
  GENERATED_CDN_DIR,
  ATHAS_ROOT,
  getContributionArray,
  getExtensionCdnPath,
  getExtensionSourceDir,
  getReservedBuiltInThemeContribution,
  listExtensionFolders,
  readDeployableExtensionManifest,
  readExtensionArtifacts,
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
  appearancePreviews?: CatalogAppearancePreview[];
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
  category:
    | "Languages"
    | "Themes"
    | "Icon Themes"
    | "Databases"
    | "Agents"
    | "Integrations"
    | "Skills";
  icon?: string;
  appearancePreviews?: CatalogAppearancePreview[];
  manifestUrl?: string;
  downloads: number;
  rating: number;
  size?: number;
  distribution?: "marketplace" | "built-in";
};

type CatalogAppearancePreview =
  | {
      id: string;
      name: string;
      description?: string;
      preview: { kind: "theme"; colors: string[] };
    }
  | {
      id: string;
      name: string;
      description?: string;
      preview: { kind: "icon-theme"; icon: string; lightIcon?: string };
    };

const registryPath = join(GENERATED_CDN_DIR, "registry.json");
const indexPath = join(GENERATED_CDN_DIR, "index.json");
const cdnBaseUrl = process.env.EXTENSIONS_CDN_BASE_URL || SERVICE_DEFAULTS.extensionsCdnBaseUrl;
const checkOnly = process.argv.includes("--check");

function normalizeIndexCategory(raw?: string): IndexEntry["category"] {
  const value = (raw ?? "").toLowerCase().replace(/[_-]+/g, " ").trim();

  if (value === "icon" || value === "icon theme" || value === "icon themes") return "Icon Themes";
  if (value === "database" || value === "databases") return "Databases";
  if (value === "agent" || value === "agents") return "Agents";
  if (value === "skill" || value === "skills") return "Skills";
  if (value === "integration" || value === "integrations") return "Integrations";
  if (value === "theme" || value === "themes") return "Themes";
  return "Languages";
}

function normalizeRegistryCategory(raw?: string): string {
  const normalized = (raw ?? "").toLowerCase();
  if (normalized.includes("icon")) return "icon-theme";
  if (normalized.includes("database")) return "database";
  if (normalized.includes("agent")) return "agent";
  if (normalized.includes("skill")) return "skill";
  if (normalized.includes("integration")) return "integration";
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

async function resolveExtensionArtwork(
  folder: string,
  cdnPath: string,
  manifest: ExtensionManifest,
): Promise<string> {
  const icon = optionalString(manifest.icon) ?? "icon.svg";
  if (/^(?:https?:|data:)/.test(icon)) return icon;
  if (icon.startsWith("asset:")) {
    throw new Error(`Extension ${manifest.id} uses an app-only asset URL for catalog artwork`);
  }

  const relativeIcon = icon.replace(/^\.\//, "");
  try {
    await access(join(getExtensionSourceDir(folder), relativeIcon));
  } catch {
    throw new Error(`Extension ${manifest.id} catalog artwork does not exist: ${relativeIcon}`);
  }

  return `${cdnBaseUrl}/${cdnPath}/${relativeIcon}`;
}

function withTrailingNewline(json: unknown): string {
  return `${JSON.stringify(json, null, 2)}\n`;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildThemePreviews(themes: Array<Record<string, unknown>>): CatalogAppearancePreview[] {
  return themes.flatMap((theme) => {
    const colors = optionalRecord(theme.colors);
    const syntax = optionalRecord(theme.syntax);
    const previewColors = [
      optionalString(colors.primary),
      optionalString(syntax.keyword),
      optionalString(syntax.string),
      optionalString(colors.surface),
      optionalString(colors.foreground),
      optionalString(colors.background),
    ]
      .filter((color): color is string => Boolean(color))
      .slice(0, 4);
    const id = optionalString(theme.id);
    const name = optionalString(theme.name);

    if (!id || !name || previewColors.length === 0) return [];

    return [
      {
        id,
        name,
        description: optionalString(theme.description),
        preview: { kind: "theme", colors: previewColors },
      },
    ];
  });
}

function resolveCatalogPreviewIcon(cdnPath: string, definition: string): string | undefined {
  if (definition.trim().startsWith("<svg")) {
    return `data:image/svg+xml,${encodeURIComponent(definition)}`;
  }
  if (/^(?:https?:|data:)/.test(definition)) return definition;
  if (definition.startsWith("asset:")) return undefined;
  return `${cdnBaseUrl}/${cdnPath}/${definition.replace(/^\.\//, "")}`;
}

function buildIconThemePreviews(
  cdnPath: string,
  icons: Array<Record<string, unknown>>,
): CatalogAppearancePreview[] {
  return icons.flatMap((icon) => {
    const contribution = icon as unknown as IconThemeContribution;
    const definitions = getIconThemePreviewDefinitions(contribution);
    const id = optionalString(icon.id);
    const name = optionalString(icon.name);
    const previewIcon = definitions
      ? resolveCatalogPreviewIcon(cdnPath, definitions.default)
      : undefined;

    if (!id || !name || !previewIcon) return [];

    const lightIcon = definitions?.light
      ? resolveCatalogPreviewIcon(cdnPath, definitions.light)
      : undefined;

    return [
      {
        id,
        name,
        description: optionalString(icon.description),
        preview: {
          kind: "icon-theme",
          icon: previewIcon,
          ...(lightIcon ? { lightIcon } : {}),
        },
      },
    ];
  });
}

async function loadBuiltInThemeIndexEntries(): Promise<IndexEntry[]> {
  const themeDirectory = join(ATHAS_ROOT, "src/extensions/themes/builtin");
  const fileNames = (await readdir(themeDirectory))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();
  const entries: IndexEntry[] = [];

  for (const fileName of fileNames) {
    const themeFile = JSON.parse(await readFile(join(themeDirectory, fileName), "utf8")) as Record<
      string,
      unknown
    >;
    const author = optionalString(themeFile.author) ?? "Athas";
    const themes = Array.isArray(themeFile.themes)
      ? (themeFile.themes as Array<Record<string, unknown>>)
      : [];

    for (const appearance of buildThemePreviews(themes)) {
      entries.push({
        id: appearance.id,
        name: appearance.name,
        description:
          appearance.description ??
          optionalString(themeFile.description) ??
          `${appearance.name} color theme`,
        version: "built-in",
        author,
        category: "Themes",
        appearancePreviews: [appearance],
        downloads: 0,
        rating: 0,
        distribution: "built-in",
      });
    }
  }

  return entries;
}

async function buildCatalog() {
  const folders = await listExtensionFolders();
  const artifacts = await readExtensionArtifacts();
  const registryEntries: RegistryEntry[] = [];
  const languageOwners = new Map<string, string>();

  for (const folder of folders) {
    const manifest = (await readDeployableExtensionManifest(
      folder,
      artifacts,
    )) as ExtensionManifest;
    const manifestPath = `extensions/${folder}/extension.json`;

    if (!manifest.id) {
      throw new Error(`Missing id in ${manifestPath}`);
    }

    const languages = getContributionArray(manifest, "languages");
    const databases = getContributionArray(manifest, "databases");
    const agents = getContributionArray(manifest, "agents");
    const themes = getContributionArray(manifest, "themes");
    const icons = getContributionArray(manifest, "icons");
    const integrations = getContributionArray(manifest, "integrations");
    const skills = getContributionArray(manifest, "skills");

    const reservedTheme = themes.find(getReservedBuiltInThemeContribution);
    if (reservedTheme) {
      throw new Error(
        `Extension ${manifest.id} contributes reserved built-in Athas theme "${String(reservedTheme.name || reservedTheme.id)}"`,
      );
    }

    if (
      languages.length === 0 &&
      databases.length === 0 &&
      agents.length === 0 &&
      themes.length === 0 &&
      icons.length === 0 &&
      integrations.length === 0 &&
      skills.length === 0
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
    const artwork = await resolveExtensionArtwork(folder, cdnPath, manifest);
    const appearancePreviews = [
      ...buildThemePreviews(themes),
      ...buildIconThemePreviews(cdnPath, icons),
    ];

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
      icon: artwork,
      appearancePreviews: appearancePreviews.length > 0 ? appearancePreviews : undefined,
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

  const marketplaceIndexEntries: IndexEntry[] = registryEntries.map((entry) => ({
    id: entry.id,
    name: entry.displayName || entry.name || entry.id,
    description: entry.description,
    version: entry.version,
    author: entry.publisher,
    category: normalizeIndexCategory(entry.category),
    icon: entry.icon,
    appearancePreviews: entry.appearancePreviews,
    manifestUrl: entry.manifestUrl,
    downloads: entry.downloads,
    rating: entry.rating,
    size: entry.size,
    distribution: "marketplace",
  }));
  const indexEntries = [...marketplaceIndexEntries, ...(await loadBuiltInThemeIndexEntries())];

  return {
    registryOutput: withTrailingNewline(registryFile),
    indexOutput: withTrailingNewline(indexEntries),
    count: indexEntries.length,
  };
}

const { registryOutput, indexOutput, count } = await buildCatalog();

if (checkOnly) {
  const currentRegistry = await readFile(registryPath, "utf8").catch(() => "");
  const currentIndex = await readFile(indexPath, "utf8").catch(() => "");

  if (currentRegistry !== registryOutput || currentIndex !== indexOutput) {
    console.error(
      "Extensions catalog is out of date. Run `bun extensions/tooling/build-extensions-index.ts`.",
    );
    process.exit(1);
  }

  console.log(`Extensions catalog check passed (${count} entries).`);
  process.exit(0);
}

await mkdir(GENERATED_CDN_DIR, { recursive: true });
await writeFile(registryPath, registryOutput, "utf8");
await writeFile(indexPath, indexOutput, "utf8");

console.log(`Wrote extensions catalog (${count} entries).`);
console.log(`- ${registryPath}`);
console.log(`- ${indexPath}`);
