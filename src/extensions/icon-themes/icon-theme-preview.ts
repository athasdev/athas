import type { IconThemeContribution } from "../types/extension-manifest";

export interface IconThemePreviewDefinitions {
  default: string;
  light?: string;
}

const fallbackPreviewTargets = [
  { fileName: "index.ts", kind: "file" as const },
  { fileName: "package.json", kind: "file" as const },
  { fileName: "src", kind: "folder" as const },
];

function normalizeLookupMap(map: Record<string, string> | undefined, withDot = false) {
  const normalized = new Map<string, string>();

  for (const [key, value] of Object.entries(map ?? {})) {
    const lookupKey = withDot && !key.startsWith(".") ? `.${key}` : key;
    normalized.set(lookupKey.toLowerCase(), value);
  }

  return normalized;
}

function getFileExtensionCandidates(fileName: string): string[] {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length < 2 || parts[0] === "") return [];
  return parts.map((_, index) => `.${parts.slice(index).join(".")}`);
}

function getPreviewIconKey(
  contribution: IconThemeContribution,
  target: { fileName: string; kind: "file" | "folder" },
): string | undefined {
  const normalizedName = target.fileName.split(/[\\/]/).pop()?.toLowerCase() ?? target.fileName;

  if (target.kind === "folder") {
    return (
      normalizeLookupMap(contribution.folders).get(normalizedName) ?? contribution.defaultFolder
    );
  }

  const filenames = normalizeLookupMap(contribution.filenames);
  const fileExtensions = normalizeLookupMap(contribution.fileExtensions, true);

  return (
    filenames.get(normalizedName) ??
    getFileExtensionCandidates(normalizedName)
      .map((extension) => fileExtensions.get(extension))
      .find(Boolean) ??
    contribution.defaultFile
  );
}

function resolveDefinition(definitions: Record<string, string>, iconKey: string) {
  return definitions[iconKey] ?? iconKey;
}

export function getIconThemePreviewDefinitions(
  contribution: IconThemeContribution,
): IconThemePreviewDefinitions | undefined {
  const targets = contribution.preview
    ? [contribution.preview, ...fallbackPreviewTargets]
    : fallbackPreviewTargets;

  for (const target of targets) {
    const iconKey = getPreviewIconKey(contribution, target);
    if (!iconKey) continue;

    return {
      default: resolveDefinition(contribution.iconDefinitions, iconKey),
      light: contribution.lightIconDefinitions
        ? resolveDefinition(contribution.lightIconDefinitions, iconKey)
        : undefined,
    };
  }

  return undefined;
}
