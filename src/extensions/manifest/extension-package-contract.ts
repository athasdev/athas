import type { ExtensionCategory, ExtensionManifest } from "../types/extension-manifest";

export const EXTENSION_SCHEMA_URL = "https://athas.dev/schemas/extension.json";

export const EXTENSION_CATEGORIES = [
  "Language",
  "Database",
  "AI",
  "Integration",
  "Agent",
  "Icon Theme",
  "Linter",
  "Formatter",
  "Theme",
  "Keymaps",
  "Snippets",
  "UI",
  "Other",
] as const satisfies readonly ExtensionCategory[];

const categoryByNormalizedName = new Map(
  EXTENSION_CATEGORIES.map((category) => [category.toLowerCase(), category]),
);

const extensionPackageFields = new Set([
  "$schema",
  "activationEvents",
  "agents",
  "aiProviders",
  "browser",
  "capabilities",
  "categories",
  "commands",
  "contributes",
  "databaseProviders",
  "databases",
  "dependencies",
  "description",
  "displayName",
  "engines",
  "extensionDependencies",
  "extensionKind",
  "extensionPack",
  "formatter",
  "grammar",
  "icon",
  "icons",
  "iconThemes",
  "id",
  "installation",
  "integrations",
  "keybindings",
  "languages",
  "license",
  "linter",
  "lsp",
  "main",
  "name",
  "permissions",
  "publisher",
  "repository",
  "snippets",
  "themes",
  "version",
]);

const requiredStringFields = [
  "id",
  "name",
  "displayName",
  "description",
  "version",
  "publisher",
] as const;

export interface ExtensionPackageManifest extends ExtensionManifest {
  $schema: typeof EXTENSION_SCHEMA_URL;
}

export interface ExtensionPackageContractIssue {
  path: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeExtensionCategories(
  rawCategories: readonly string[] | undefined,
  fallback: ExtensionCategory = "Other",
): ExtensionCategory[] {
  if (!rawCategories?.length) return [fallback];

  return rawCategories.map((category) => {
    const normalized = category.trim().toLowerCase().replace(/-/g, " ");
    if (normalized === "icontheme") return "Icon Theme";
    return categoryByNormalizedName.get(normalized) ?? "Other";
  });
}

export function validateExtensionPackageContract(value: unknown): ExtensionPackageContractIssue[] {
  if (!isRecord(value)) {
    return [{ path: "$", message: "Manifest must be a JSON object" }];
  }

  const issues: ExtensionPackageContractIssue[] = [];

  for (const field of Object.keys(value)) {
    if (!extensionPackageFields.has(field)) {
      issues.push({ path: field, message: `Unknown top-level field '${field}'` });
    }
  }

  if (value.$schema !== EXTENSION_SCHEMA_URL) {
    issues.push({
      path: "$schema",
      message: `Manifest must use '${EXTENSION_SCHEMA_URL}'`,
    });
  }

  for (const field of requiredStringFields) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0) {
      issues.push({ path: field, message: `'${field}' must be a non-empty string` });
    }
  }

  if (!Array.isArray(value.categories) || value.categories.length === 0) {
    issues.push({ path: "categories", message: "'categories' must be a non-empty array" });
  } else {
    for (const [index, category] of value.categories.entries()) {
      if (
        typeof category !== "string" ||
        !EXTENSION_CATEGORIES.includes(category as ExtensionCategory)
      ) {
        issues.push({
          path: `categories.${index}`,
          message: `Unknown extension category '${String(category)}'`,
        });
      }
    }
  }

  if (isRecord(value.installation) && "platforms" in value.installation) {
    issues.push({
      path: "installation.platforms",
      message: "Use platformArch packages instead of the retired platform-only map",
    });
  }

  return issues;
}

export function parseExtensionPackageManifest(value: unknown): ExtensionPackageManifest {
  const issues = validateExtensionPackageContract(value);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  }

  return value as ExtensionPackageManifest;
}
