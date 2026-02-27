/**
 * Language Extension Packager
 * Fetches extension manifests from the CDN and converts them to internal ExtensionManifest format.
 */

import type {
  ExtensionCategory,
  ExtensionManifest,
  FormatterConfiguration,
  LinterConfiguration,
  LspConfiguration,
  PlatformExecutable,
  ToolRuntime,
} from "../types/extension-manifest";

const CDN_BASE_URL = import.meta.env.VITE_PARSER_CDN_URL || "https://athas.dev/extensions";
const MANIFESTS_URL = `${CDN_BASE_URL}/manifests.json`;

interface ExternalLanguageContribution {
  id: string;
  extensions: string[];
  aliases?: string[];
  filenames?: string[];
}

interface ExternalToolConfig {
  name?: string;
  runtime?: ToolRuntime;
  package?: string;
  downloadUrl?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ExternalLanguageManifest {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  publisher?: string;
  categories?: string[];
  languages?: ExternalLanguageContribution[];
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

type PackagedLanguageEntry = {
  manifest: ExtensionManifest;
  languageIds: string[];
  wasmUrl: string;
  highlightQueryUrl: string;
};

function toExtensionCategories(rawCategories: string[] | undefined): ExtensionCategory[] {
  if (!rawCategories || rawCategories.length === 0) return ["Language"];

  return rawCategories.map((category) => {
    const normalized = category.trim().toLowerCase();
    if (normalized === "language") return "Language";
    if (normalized === "linter") return "Linter";
    if (normalized === "formatter") return "Formatter";
    if (normalized === "theme") return "Theme";
    if (normalized === "keymaps") return "Keymaps";
    if (normalized === "snippets") return "Snippets";
    return "Other";
  });
}

function normalizeExtensions(extensions: string[]): string[] {
  return extensions.map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
}

function defaultCommand(name?: string): PlatformExecutable {
  return { default: name || "" };
}

function createLspConfig(manifest: ExternalLanguageManifest): LspConfiguration | undefined {
  const lsp = manifest.capabilities?.lsp;
  const languages = manifest.languages || [];
  if (!lsp?.name || languages.length === 0) return undefined;

  const fileExtensions = languages.flatMap((lang) => normalizeExtensions(lang.extensions || []));
  const languageIds = languages.map((lang) => lang.id);

  return {
    name: lsp.name,
    runtime: lsp.runtime,
    package: lsp.package,
    downloadUrl: lsp.downloadUrl,
    server: defaultCommand(lsp.name),
    args: lsp.args || [],
    env: lsp.env,
    fileExtensions,
    languageIds,
  };
}

function createFormatterConfig(
  manifest: ExternalLanguageManifest,
): FormatterConfiguration | undefined {
  const formatter = manifest.capabilities?.formatter;
  const languageIds = (manifest.languages || []).map((lang) => lang.id);
  if (!formatter?.name || languageIds.length === 0) return undefined;

  return {
    name: formatter.name,
    runtime: formatter.runtime,
    package: formatter.package,
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
  const languageIds = (manifest.languages || []).map((lang) => lang.id);
  if (!linter?.name || languageIds.length === 0) return undefined;

  return {
    name: linter.name,
    runtime: linter.runtime,
    package: linter.package,
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
  const folderMatch = path.match(/\/extensions\/([^/]+)\/extension\.json$/);
  const folder = folderMatch?.[1];

  if (!folder) {
    throw new Error(`Could not resolve extension folder from path: ${path}`);
  }

  const languages = (manifest.languages || []).map((language) => ({
    id: language.id,
    extensions: normalizeExtensions(language.extensions || []),
    aliases: language.aliases,
    filenames: language.filenames,
  }));

  if (languages.length === 0) {
    throw new Error(`No language contributions found for ${manifest.id}`);
  }

  const wasmUrl = `${CDN_BASE_URL}/${folder}/parser.wasm`;
  const highlightQueryUrl = `${CDN_BASE_URL}/${folder}/highlights.scm`;
  const primaryLanguageId = languages[0].id;

  const converted: ExtensionManifest = {
    id: manifest.id,
    name: manifest.name,
    displayName: manifest.displayName || manifest.name,
    description: manifest.description || `${manifest.name} language support`,
    version: manifest.version || "1.0.0",
    publisher: manifest.publisher || "Athas",
    categories: toExtensionCategories(manifest.categories),
    languages,
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

function processManifests(manifests: Record<string, ExternalLanguageManifest>) {
  packagedEntries = [];
  manifestByLanguageId.clear();
  wasmUrlByLanguageId.clear();
  highlightUrlByLanguageId.clear();
  highlightUrlByExtensionId.clear();

  for (const [folder, manifest] of Object.entries(manifests)) {
    try {
      const syntheticPath = `/extensions/${folder}/extension.json`;
      const entry = convertLanguageManifest(syntheticPath, manifest);
      packagedEntries.push(entry);

      highlightUrlByExtensionId.set(entry.manifest.id, entry.highlightQueryUrl);

      for (const languageId of entry.languageIds) {
        manifestByLanguageId.set(languageId, entry.manifest);
        wasmUrlByLanguageId.set(languageId, entry.wasmUrl);
        highlightUrlByLanguageId.set(languageId, entry.highlightQueryUrl);
      }
    } catch (error) {
      console.error(`Failed to convert language manifest for ${folder}:`, error);
    }
  }

  packagedExtensions = packagedEntries.map((entry) => entry.manifest);
  initialized = true;
}

/**
 * Initialize the language packager by fetching manifests from the CDN.
 * Must be called before using any getter functions.
 */
export async function initializeLanguagePackager(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const response = await fetch(MANIFESTS_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch manifests: ${response.status} ${response.statusText}`);
      }
      const manifests: Record<string, ExternalLanguageManifest> = await response.json();
      processManifests(manifests);
    } catch (error) {
      console.error("Failed to load extension manifests from CDN:", error);
      // Initialize with empty state so the editor can still function
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

export function getLanguageExtensionByFileExt(fileExt: string): ExtensionManifest | undefined {
  const ext = fileExt.startsWith(".") ? fileExt : `.${fileExt}`;
  return packagedExtensions.find((extension) =>
    extension.languages?.some((language) => language.extensions.includes(ext)),
  );
}

export function getWasmUrlForLanguage(languageId: string): string {
  return wasmUrlByLanguageId.get(languageId) || `${CDN_BASE_URL}/${languageId}/parser.wasm`;
}

export function getHighlightQueryUrl(languageId: string): string {
  return highlightUrlByLanguageId.get(languageId) || `${CDN_BASE_URL}/${languageId}/highlights.scm`;
}

export function getHighlightQueryUrlForExtension(manifest: ExtensionManifest): string {
  return (
    highlightUrlByExtensionId.get(manifest.id) ||
    (manifest.languages?.[0] ? getHighlightQueryUrl(manifest.languages[0].id) : "")
  );
}
