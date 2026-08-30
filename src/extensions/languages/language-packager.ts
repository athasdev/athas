/**
 * Language Extension Packager
 * Fetches extension manifests from the CDN and converts them to internal ExtensionManifest format.
 */

import type {
  ExtensionManifest,
  FormatterConfiguration,
  LinterConfiguration,
  LspConfiguration,
  PlatformExecutable,
  ToolRuntime,
} from "../types/extension-manifest";
import { normalizeExtensionCategories } from "../manifest/extension-package-contract";
import { getManifestLanguageContributions } from "../types/extension-contributions";
import { loadExtensionCatalog } from "../marketplace/extension-catalog";
import { registerLanguageAssetOverride } from "@/features/editor/lib/wasm-parser/extension-assets";
import { getServiceUrls } from "@/config/services";

const CDN_BASE_URL = getServiceUrls().extensionsCdnBaseUrl;
const BUNDLED_PARSER_BASE_URL = "/tree-sitter/parsers";

interface ExternalLanguageContribution {
  id: string;
  extensions?: string[];
  aliases?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
}

interface ExternalToolConfig {
  name?: string;
  runtime?: ToolRuntime;
  package?: string;
  packages?: string[];
  downloadUrl?: string;
  args?: string[];
  env?: Record<string, string>;
  initializationOptions?: Record<string, unknown>;
}

interface ExternalLanguageManifest {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  publisher?: string;
  categories?: string[];
  icon?: string;
  languages?: ExternalLanguageContribution[];
  contributes?: {
    languages?: ExternalLanguageContribution[];
  };
  capabilities?: {
    grammar?: {
      wasmPath?: string;
      highlightQuery?: string;
      scopeName?: string;
    };
    lsp?: ExternalToolConfig;
    formatter?: ExternalToolConfig;
    linter?: ExternalToolConfig;
  };
}

const BUNDLED_LANGUAGE_MANIFESTS = import.meta.glob<ExternalLanguageManifest>(
  "../../../extensions/official/*/extension.json",
  { eager: true, import: "default" },
);

type PackagedLanguageEntry = {
  manifest: ExtensionManifest;
  languageIds: string[];
  wasmUrl: string;
  highlightQueryUrl: string;
};

function normalizeExtensions(extensions: string[]): string[] {
  return extensions.map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
}

function getExternalLanguages(manifest: ExternalLanguageManifest): ExternalLanguageContribution[] {
  return [...(manifest.languages || []), ...(manifest.contributes?.languages || [])];
}

function defaultCommand(name?: string): PlatformExecutable {
  return { default: name || "" };
}

function isAbsoluteAssetUrl(value: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith("/");
}

function resolveExtensionAssetUrl(
  folder: string,
  assetPath: string | undefined,
  fallbackFilename: string,
): string {
  const normalized = assetPath?.trim() || fallbackFilename;

  if (isAbsoluteAssetUrl(normalized)) {
    return normalized;
  }

  return `${CDN_BASE_URL}/${folder}/${normalized.replace(/^\.?\//, "")}`;
}

export function resolveLanguageAssetUrl(
  folder: string,
  assetPath: string | undefined,
  fallbackFilename: string,
): string {
  if (!assetPath || assetPath.trim().length === 0) {
    return `${BUNDLED_PARSER_BASE_URL}/${folder}/${fallbackFilename}`;
  }

  const normalized = assetPath.trim();
  if (isAbsoluteAssetUrl(normalized)) {
    return normalized;
  }

  return `${BUNDLED_PARSER_BASE_URL}/${folder}/${normalized}`;
}

function createLspConfig(manifest: ExternalLanguageManifest): LspConfiguration | undefined {
  const lsp = manifest.capabilities?.lsp;
  const languages = getExternalLanguages(manifest);
  if (!lsp?.name || languages.length === 0) return undefined;

  const fileExtensions = languages.flatMap((lang) => normalizeExtensions(lang.extensions || []));
  const languageIds = languages.map((lang) => lang.id);

  return {
    name: lsp.name,
    runtime: lsp.runtime,
    package: lsp.package,
    packages: lsp.packages,
    downloadUrl: lsp.downloadUrl,
    server: defaultCommand(lsp.name),
    args: lsp.args || [],
    env: lsp.env,
    initializationOptions: lsp.initializationOptions,
    fileExtensions,
    languageIds,
  };
}

function createFormatterConfig(
  manifest: ExternalLanguageManifest,
): FormatterConfiguration | undefined {
  const formatter = manifest.capabilities?.formatter;
  const languageIds = getExternalLanguages(manifest).map((lang) => lang.id);
  if (!formatter?.name || languageIds.length === 0) return undefined;

  return {
    name: formatter.name,
    runtime: formatter.runtime,
    package: formatter.package,
    packages: formatter.packages,
    downloadUrl: formatter.downloadUrl,
    command: defaultCommand(formatter.name),
    args: formatter.args || [],
    env: formatter.env,
    inputMethod: "stdin",
    outputMethod: "stdout",
    languages: languageIds,
  };
}

function createLinterConfig(manifest: ExternalLanguageManifest): LinterConfiguration | undefined {
  const linter = manifest.capabilities?.linter;
  const languageIds = getExternalLanguages(manifest).map((lang) => lang.id);
  if (!linter?.name || languageIds.length === 0) return undefined;

  return {
    name: linter.name,
    runtime: linter.runtime,
    package: linter.package,
    packages: linter.packages,
    downloadUrl: linter.downloadUrl,
    command: defaultCommand(linter.name),
    args: linter.args || [],
    env: linter.env,
    inputMethod: "stdin",
    languages: languageIds,
  };
}

function convertLanguageManifest(
  path: string,
  manifest: ExternalLanguageManifest,
): PackagedLanguageEntry {
  const folderMatch = path.match(/(?:^|\/)([^/]+)\/extension\.json$/);
  const folder = folderMatch?.[1];

  if (!folder) {
    throw new Error(`Could not resolve extension folder from path: ${path}`);
  }

  const languages = getExternalLanguages(manifest).map((language) => ({
    id: language.id,
    extensions: normalizeExtensions(language.extensions || []),
    aliases: language.aliases,
    filenames: language.filenames,
    filenamePatterns: language.filenamePatterns,
  }));

  if (languages.length === 0) {
    throw new Error(`No language contributions found for ${manifest.id}`);
  }

  const wasmUrl = resolveLanguageAssetUrl(
    folder,
    manifest.capabilities?.grammar?.wasmPath,
    "parser.wasm",
  );
  const highlightQueryUrl = resolveLanguageAssetUrl(
    folder,
    manifest.capabilities?.grammar?.highlightQuery,
    "highlights.scm",
  );
  const primaryLanguageId = languages[0].id;

  const converted: ExtensionManifest = {
    id: manifest.id,
    name: manifest.name,
    displayName: manifest.displayName || manifest.name,
    description: manifest.description || `${manifest.name} language support`,
    version: manifest.version || "1.0.0",
    publisher: manifest.publisher || "Athas",
    categories: normalizeExtensionCategories(manifest.categories, "Language"),
    icon: resolveExtensionAssetUrl(folder, manifest.icon, "icon.svg"),
    languages,
    contributes: {
      languages,
    },
    grammar: {
      wasmPath: wasmUrl,
      scopeName: manifest.capabilities?.grammar?.scopeName || `source.${primaryLanguageId}`,
      languageId: primaryLanguageId,
    },
    lsp: createLspConfig(manifest),
    formatter: createFormatterConfig(manifest),
    linter: createLinterConfig(manifest),
    activationEvents: languages.map((lang) => `onLanguage:${lang.id}`),
    installation: {
      downloadUrl: wasmUrl,
      size: 0,
      checksum: "",
      minEditorVersion: "0.1.0",
    },
  };

  return {
    manifest: converted,
    languageIds: languages.map((lang) => lang.id),
    wasmUrl,
    highlightQueryUrl,
  };
}

let packagedEntries: PackagedLanguageEntry[] = [];
const manifestByLanguageId = new Map<string, ExtensionManifest>();
const wasmUrlByLanguageId = new Map<string, string>();
const highlightUrlByLanguageId = new Map<string, string>();
const highlightUrlByExtensionId = new Map<string, string>();
let packagedExtensions: ExtensionManifest[] = [];
let initialized = false;
let initPromise: Promise<void> | null = null;

function processManifests(
  manifests: Record<string, ExternalLanguageManifest>,
  markInitialized = true,
) {
  packagedEntries = [];
  manifestByLanguageId.clear();
  wasmUrlByLanguageId.clear();
  highlightUrlByLanguageId.clear();
  highlightUrlByExtensionId.clear();

  for (const [pathOrFolder, manifest] of Object.entries(manifests)) {
    try {
      if (getExternalLanguages(manifest).length === 0) {
        continue;
      }

      const manifestPath = pathOrFolder.endsWith("/extension.json")
        ? pathOrFolder
        : `/extensions/${pathOrFolder}/extension.json`;
      const entry = convertLanguageManifest(manifestPath, manifest);
      packagedEntries.push(entry);

      highlightUrlByExtensionId.set(entry.manifest.id, entry.highlightQueryUrl);

      for (const languageId of entry.languageIds) {
        manifestByLanguageId.set(languageId, entry.manifest);
        wasmUrlByLanguageId.set(languageId, entry.wasmUrl);
        highlightUrlByLanguageId.set(languageId, entry.highlightQueryUrl);
        registerLanguageAssetOverride(languageId, {
          wasmPath: entry.wasmUrl,
          highlightQueryUrl: entry.highlightQueryUrl,
        });
      }
    } catch (error) {
      console.error(`Failed to convert language manifest for ${pathOrFolder}:`, error);
    }
  }

  packagedExtensions = packagedEntries.map((entry) => entry.manifest);
  initialized = markInitialized;
}

processManifests(BUNDLED_LANGUAGE_MANIFESTS, false);

/**
 * Initialize the language packager by fetching manifests from the CDN.
 * Must be called before using any getter functions.
 */
export async function initializeLanguagePackager(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const manifests = await loadExtensionCatalog<ExternalLanguageManifest>();
      processManifests(manifests);
    } catch (error) {
      console.warn("Failed to load extension manifests from CDN:", error);
      initialized = true;
    }
  })();

  return initPromise;
}

export function getPackagedLanguageExtensions(): ExtensionManifest[] {
  return packagedExtensions;
}

export function getLanguageExtensionById(languageId: string): ExtensionManifest | undefined {
  return manifestByLanguageId.get(languageId);
}

export function getWasmUrlForLanguage(languageId: string): string {
  return (
    wasmUrlByLanguageId.get(languageId) || `${BUNDLED_PARSER_BASE_URL}/${languageId}/parser.wasm`
  );
}

export function getHighlightQueryUrl(languageId: string): string {
  return (
    highlightUrlByLanguageId.get(languageId) ||
    `${BUNDLED_PARSER_BASE_URL}/${languageId}/highlights.scm`
  );
}

export function getHighlightQueryUrlForExtension(manifest: ExtensionManifest): string {
  const languages = getManifestLanguageContributions(manifest);

  return (
    highlightUrlByExtensionId.get(manifest.id) ||
    (languages[0] ? getHighlightQueryUrl(languages[0].id) : "")
  );
}
