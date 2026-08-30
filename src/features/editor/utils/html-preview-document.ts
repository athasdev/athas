import { convertFileSrc } from "@tauri-apps/api/core";
import { getDirName, joinPath } from "@/utils/path-helpers";

type ConvertFilePathToUrl = (path: string) => string;

interface BuildHtmlPreviewDocumentOptions {
  sourcePath?: string;
  rootFolderPath?: string;
  convertFilePathToUrl?: ConvertFilePathToUrl;
}

const URL_ATTRIBUTE_PATTERN = /\b(src|href|poster)=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const SRCSET_ATTRIBUTE_PATTERN = /\bsrcset=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const MODULE_SCRIPT_PATTERN =
  /<script\b(?=[^>]*\btype\s*=\s*(?:"module"|'module'|module)(?:\s|>|\/))[^>]*>([\s\S]*?)<\/script>/gi;
const STATIC_MODULE_SPECIFIER_PATTERN =
  /\b((?:import|export)\s+(?:[^"']*?\s+from\s*)?)(["'])(\/(?!\/)[^"']+)\2/g;
const DYNAMIC_MODULE_SPECIFIER_PATTERN = /\b(import\s*\(\s*)(["'])(\/(?!\/)[^"']+)\2/g;

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function splitUrlSuffix(value: string): { path: string; suffix: string } {
  const suffixIndex = value.search(/[?#]/);
  if (suffixIndex < 0) {
    return { path: value, suffix: "" };
  }

  return {
    path: value.slice(0, suffixIndex),
    suffix: value.slice(suffixIndex),
  };
}

function shouldLeaveUrlUntouched(value: string): boolean {
  return (
    value.length === 0 ||
    value.startsWith("#") ||
    value.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  );
}

function rewriteRootRelativeUrl(
  value: string,
  rootPath: string | undefined,
  convertFilePathToUrl: ConvertFilePathToUrl,
): string {
  if (shouldLeaveUrlUntouched(value) || !value.startsWith("/") || !rootPath) {
    return value;
  }

  const { path, suffix } = splitUrlSuffix(value);
  const filePath = joinPath(rootPath, path.slice(1));

  return `${convertFilePathToUrl(filePath)}${suffix}`;
}

function rewriteSrcSet(
  value: string,
  rootPath: string | undefined,
  convertFilePathToUrl: ConvertFilePathToUrl,
): string {
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      const [url, ...descriptors] = trimmed.split(/\s+/);
      if (!url) return candidate;

      const rewrittenUrl = rewriteRootRelativeUrl(url, rootPath, convertFilePathToUrl);
      return [rewrittenUrl, ...descriptors].join(" ");
    })
    .join(", ");
}

function rewriteRootRelativeAttributes(
  content: string,
  rootPath: string | undefined,
  convertFilePathToUrl: ConvertFilePathToUrl,
): string {
  const rewrittenUrlAttributes = content.replace(
    URL_ATTRIBUTE_PATTERN,
    (
      match,
      attributeName: string,
      doubleQuoted?: string,
      singleQuoted?: string,
      unquoted?: string,
    ) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
      const rewrittenValue = rewriteRootRelativeUrl(value, rootPath, convertFilePathToUrl);

      if (rewrittenValue === value) {
        return match;
      }

      return `${attributeName}="${escapeHtmlAttribute(rewrittenValue)}"`;
    },
  );

  return rewrittenUrlAttributes.replace(
    SRCSET_ATTRIBUTE_PATTERN,
    (match, doubleQuoted?: string, singleQuoted?: string, unquoted?: string) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
      const rewrittenValue = rewriteSrcSet(value, rootPath, convertFilePathToUrl);

      if (rewrittenValue === value) {
        return match;
      }

      return `srcset="${escapeHtmlAttribute(rewrittenValue)}"`;
    },
  );
}

function rewriteRootRelativeModuleSpecifiers(
  content: string,
  rootPath: string | undefined,
  convertFilePathToUrl: ConvertFilePathToUrl,
): string {
  return content.replace(MODULE_SCRIPT_PATTERN, (scriptTag, scriptContent: string) => {
    const rewrittenScriptContent = scriptContent
      .replace(
        STATIC_MODULE_SPECIFIER_PATTERN,
        (match, prefix: string, quote: string, value: string) => {
          const rewrittenValue = rewriteRootRelativeUrl(value, rootPath, convertFilePathToUrl);
          return rewrittenValue === value ? match : `${prefix}${quote}${rewrittenValue}${quote}`;
        },
      )
      .replace(
        DYNAMIC_MODULE_SPECIFIER_PATTERN,
        (match, prefix: string, quote: string, value: string) => {
          const rewrittenValue = rewriteRootRelativeUrl(value, rootPath, convertFilePathToUrl);
          return rewrittenValue === value ? match : `${prefix}${quote}${rewrittenValue}${quote}`;
        },
      );

    return scriptTag.replace(scriptContent, rewrittenScriptContent);
  });
}

function injectBaseTag(content: string, baseUrl: string): string {
  if (!baseUrl || /<base\b/i.test(content)) {
    return content;
  }

  const baseTag = `<base href="${escapeHtmlAttribute(baseUrl)}">`;

  if (/<head\b[^>]*>/i.test(content)) {
    return content.replace(/<head\b[^>]*>/i, (headTag) => `${headTag}\n${baseTag}`);
  }

  if (/<html\b[^>]*>/i.test(content)) {
    return content.replace(/<html\b[^>]*>/i, (htmlTag) => `${htmlTag}\n<head>${baseTag}</head>`);
  }

  return `${baseTag}\n${content}`;
}

export function buildHtmlPreviewDocument(
  sourceContent: string,
  {
    sourcePath,
    rootFolderPath,
    convertFilePathToUrl = convertFileSrc,
  }: BuildHtmlPreviewDocumentOptions = {},
): string {
  if (!sourcePath) {
    return sourceContent;
  }

  const sourceDirPath = getDirName(sourcePath);
  const assetBaseUrl = sourceDirPath ? convertFilePathToUrl(sourceDirPath) : "";
  const normalizedAssetBaseUrl =
    assetBaseUrl && !assetBaseUrl.endsWith("/") ? `${assetBaseUrl}/` : assetBaseUrl;
  const rootRelativeAssetPath = rootFolderPath || sourceDirPath;
  const contentWithRewrittenAttributes = rewriteRootRelativeAttributes(
    sourceContent,
    rootRelativeAssetPath,
    convertFilePathToUrl,
  );
  const content = rewriteRootRelativeModuleSpecifiers(
    contentWithRewrittenAttributes,
    rootRelativeAssetPath,
    convertFilePathToUrl,
  );

  return injectBaseTag(content, normalizedAssetBaseUrl);
}
