import type { UIExtensionRegistration } from "../../types/ui-extension";

type GeneratedContributionType = NonNullable<UIExtensionRegistration["contributionType"]>;

export interface GeneratedUIExtension {
  id: string;
  name: string;
  description: string;
  contributionType: GeneratedContributionType;
  code: string;
}

const GENERATED_EXTENSIONS_STORAGE_KEY = "athas.generated-ui-extensions";

export function normalizeGeneratedExtensionId(id: string): string {
  const normalized = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `generated.${normalized || Date.now().toString(36)}`;
}

export function readStoredGeneratedExtensions(): GeneratedUIExtension[] {
  const raw = localStorage.getItem(GENERATED_EXTENSIONS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (extension): extension is GeneratedUIExtension =>
        extension &&
        typeof extension === "object" &&
        typeof extension.id === "string" &&
        typeof extension.name === "string" &&
        typeof extension.description === "string" &&
        typeof extension.code === "string" &&
        ["sidebar", "toolbar", "command"].includes(extension.contributionType),
    );
  } catch {
    return [];
  }
}

export function storeGeneratedExtension(extension: GeneratedUIExtension): void {
  const storedExtensions = readStoredGeneratedExtensions();
  const nextExtensions = [
    ...storedExtensions.filter((storedExtension) => storedExtension.id !== extension.id),
    extension,
  ];

  localStorage.setItem(GENERATED_EXTENSIONS_STORAGE_KEY, JSON.stringify(nextExtensions));
}
