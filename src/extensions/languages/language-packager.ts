/**
 * Language Extension Packager
 * Converts language manifest files to ExtensionManifest format for the extension store
 */

import type { ExtensionManifest } from "../types/extension-manifest";

// CDN base URL for downloading WASM parsers and highlight queries
// Can be configured via environment variable
const CDN_BASE_URL = import.meta.env.VITE_PARSER_CDN_URL || "https://athas.dev/extensions";

// Old manifest format from JSON files
interface LanguageManifestFile {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  author: string;
  capabilities: {
    languageProvider: {
      id: string;
      extensions: string[];
      aliases: string[];
      wasmPath: string;
      highlightQuery: string;
    };
  };
}

/**
 * Convert a language manifest file to ExtensionManifest format
 */
function convertLanguageManifest(manifest: LanguageManifestFile): ExtensionManifest {
  const { capabilities } = manifest;
  const { languageProvider } = capabilities;

  // Convert file extensions to include dots
  const extensions = languageProvider.extensions.map((ext) =>
    ext.startsWith(".") ? ext : `.${ext}`,
  );

  // Extract parser name from wasmPath
  // "/tree-sitter/parsers/tree-sitter-javascript.wasm" -> "tree-sitter-javascript.wasm"
  const wasmFileName = languageProvider.wasmPath.split("/").pop() || "";

  return {
    id: manifest.id,
    name: manifest.name,
    displayName: manifest.name,
    description: manifest.description,
    version: manifest.version,
    publisher: manifest.author,
    categories: ["Language"],
    languages: [
      {
        id: languageProvider.id,
        extensions,
        aliases: languageProvider.aliases,
      },
    ],
    activationEvents: [`onLanguage:${languageProvider.id}`],
    // Extension is downloadable from CDN
    installation: {
      downloadUrl: `${CDN_BASE_URL}/parsers/${wasmFileName}`,
      size: 0, // Will be determined during download
      checksum: "", // Will be calculated after download
      minEditorVersion: "0.1.0",
    },
  };
}

// Import all manifest files
const manifestModules = import.meta.glob<LanguageManifestFile>("./manifests/*.json", {
  eager: true,
  import: "default",
});

/**
 * Get all packaged language extensions
 */
export function getPackagedLanguageExtensions(): ExtensionManifest[] {
  const extensions: ExtensionManifest[] = [];

  for (const [path, manifest] of Object.entries(manifestModules)) {
    try {
      const converted = convertLanguageManifest(manifest);
      extensions.push(converted);
    } catch (error) {
      console.error(`Failed to convert language manifest at ${path}:`, error);
    }
  }

  return extensions;
}

/**
 * Get language extension by language ID
 */
export function getLanguageExtensionById(languageId: string): ExtensionManifest | undefined {
  const extensions = getPackagedLanguageExtensions();
  return extensions.find((ext) => ext.languages?.some((lang) => lang.id === languageId));
}

/**
 * Get language extension by file extension
 */
export function getLanguageExtensionByFileExt(fileExt: string): ExtensionManifest | undefined {
  const ext = fileExt.startsWith(".") ? fileExt : `.${fileExt}`;
  const extensions = getPackagedLanguageExtensions();

  return extensions.find((extension) =>
    extension.languages?.some((lang) => lang.extensions.includes(ext)),
  );
}

/**
 * Get WASM download URL for a language
 */
export function getWasmUrlForLanguage(languageId: string): string {
  return `${CDN_BASE_URL}/parsers/tree-sitter-${languageId}.wasm`;
}

/**
 * Get highlight query URL for a language
 */
export function getHighlightQueryUrl(languageId: string): string {
  return `${CDN_BASE_URL}/queries/${languageId}/highlights.scm`;
}
