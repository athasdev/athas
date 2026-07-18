import type { Settings } from "@/features/settings/types/settings.types";
import type { V0DesignSystemProfile } from "@/extensions/v0/types/v0-design-system.types";

const MAX_V0_DESIGN_SYSTEMS = 50;
const MAX_FIELD_LENGTH = 500;

const V0_DESIGN_SYSTEM_PROMPT_PREFIX = "Use this design system for generated UI:";
export const SHADCN_REGISTRY_DIRECTORY_URL = "https://ui.shadcn.com/r/registries.json";

export interface V0DesignSystemSuggestion {
  id: string;
  name: string;
  registryUrl: string;
  description?: string;
  homepage?: string;
  source: "suggested" | "directory";
}

interface ShadcnRegistryDirectoryEntry {
  name?: unknown;
  homepage?: unknown;
  url?: unknown;
  description?: unknown;
}

export const SUGGESTED_V0_DESIGN_SYSTEMS: V0DesignSystemSuggestion[] = [
  {
    id: "suggested-registry-starter",
    name: "Registry Starter",
    registryUrl: "https://registry-starter.vercel.app/r/registry.json",
    homepage: "https://registry-starter.vercel.app",
    description: "Vercel registry starter with theme, shadcn/ui primitives, and sample blocks.",
    source: "suggested",
  },
];

function trimOptional(value: unknown, maxLength = MAX_FIELD_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || undefined;
}

function toStableId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "v0-design-system";
}

export function createV0DesignSystemId(name: string, registryUrl: string): string {
  return toStableId(`${name}-${registryUrl}`);
}

export function normalizeV0DesignSystems(value: unknown): V0DesignSystemProfile[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const seenRegistryUrls = new Set<string>();

  return value
    .map((profile): V0DesignSystemProfile | null => {
      if (!profile || typeof profile !== "object") return null;

      const candidate = profile as Partial<V0DesignSystemProfile>;
      const registryUrl = trimOptional(candidate.registryUrl);
      if (!registryUrl) return null;

      const name = trimOptional(candidate.name, 120) || registryUrl;
      const id = trimOptional(candidate.id, 120) || createV0DesignSystemId(name, registryUrl);
      const description = trimOptional(candidate.description, 240);
      const homepage = trimOptional(candidate.homepage);
      const tailwindConfigPath = trimOptional(candidate.tailwindConfigPath);
      const globalsCssPath = trimOptional(candidate.globalsCssPath);
      const componentsJsonPath = trimOptional(candidate.componentsJsonPath);

      return {
        id,
        name,
        registryUrl,
        ...(description ? { description } : {}),
        ...(homepage ? { homepage } : {}),
        ...(tailwindConfigPath ? { tailwindConfigPath } : {}),
        ...(globalsCssPath ? { globalsCssPath } : {}),
        ...(componentsJsonPath ? { componentsJsonPath } : {}),
      };
    })
    .filter((profile): profile is V0DesignSystemProfile => {
      if (!profile) return false;
      if (seenIds.has(profile.id)) return false;
      if (seenRegistryUrls.has(profile.registryUrl)) return false;
      seenIds.add(profile.id);
      seenRegistryUrls.add(profile.registryUrl);
      return true;
    })
    .slice(0, MAX_V0_DESIGN_SYSTEMS);
}

export function inferRegistryIndexUrl(urlTemplate: string): string | null {
  const trimmedTemplate = urlTemplate.trim();
  if (!trimmedTemplate || trimmedTemplate.includes("{style}")) return null;
  if (!trimmedTemplate.includes("{name}")) return null;
  return trimmedTemplate.replace("{name}", "registry");
}

export function parseV0DesignSystemDirectory(value: unknown): V0DesignSystemSuggestion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry): V0DesignSystemSuggestion | null => {
      if (!entry || typeof entry !== "object") return null;

      const candidate = entry as ShadcnRegistryDirectoryEntry;
      const name = trimOptional(candidate.name, 120);
      const urlTemplate = trimOptional(candidate.url);
      if (!name || !urlTemplate) return null;

      const registryUrl = inferRegistryIndexUrl(urlTemplate);
      if (!registryUrl) return null;

      return {
        id: `directory-${toStableId(name)}`,
        name,
        registryUrl,
        ...(trimOptional(candidate.description, 240)
          ? { description: trimOptional(candidate.description, 240) }
          : {}),
        ...(trimOptional(candidate.homepage) ? { homepage: trimOptional(candidate.homepage) } : {}),
        source: "directory",
      };
    })
    .filter((entry): entry is V0DesignSystemSuggestion => entry !== null);
}

export function buildV0DesignSystemProfileFromRegistry(
  registry: unknown,
  registryUrl: string,
  fallback: Pick<V0DesignSystemProfile, "id" | "name" | "registryUrl"> &
    Partial<V0DesignSystemProfile>,
): V0DesignSystemProfile {
  const registryRecord =
    registry && typeof registry === "object" && !Array.isArray(registry)
      ? (registry as Record<string, unknown>)
      : {};
  const items = Array.isArray(registryRecord.items) ? registryRecord.items : [];
  const registryName = trimOptional(registryRecord.name, 120);
  const homepage = trimOptional(registryRecord.homepage);
  const registryDescription = trimOptional(registryRecord.description, 240);
  const fallbackDescription = trimOptional(fallback.description, 240);
  const itemSummary = items.length > 0 ? `${items.length} registry items` : undefined;

  return {
    id: fallback.id,
    name: registryName || fallback.name,
    registryUrl,
    ...(registryDescription || fallbackDescription || itemSummary
      ? { description: registryDescription || fallbackDescription || itemSummary }
      : {}),
    ...(homepage ? { homepage } : {}),
  };
}

export function getActiveV0DesignSystem(
  settings: Pick<Settings, "activeV0DesignSystemId" | "v0DesignSystems">,
): V0DesignSystemProfile | null {
  return (
    settings.v0DesignSystems.find((profile) => profile.id === settings.activeV0DesignSystemId) ??
    null
  );
}

export function buildV0DesignSystemPrompt(profile: V0DesignSystemProfile | null): string {
  if (!profile) return "";

  const lines = [
    V0_DESIGN_SYSTEM_PROMPT_PREFIX,
    `- Name: ${profile.name}`,
    `- Registry URL: ${profile.registryUrl}`,
  ];

  if (profile.description) {
    lines.push(`- Notes: ${profile.description}`);
  }
  if (profile.tailwindConfigPath) {
    lines.push(`- Tailwind config path: ${profile.tailwindConfigPath}`);
  }
  if (profile.globalsCssPath) {
    lines.push(`- Global CSS path: ${profile.globalsCssPath}`);
  }
  if (profile.componentsJsonPath) {
    lines.push(`- components.json path: ${profile.componentsJsonPath}`);
  }

  lines.push(
    "- Prefer registry components, tokens, CSS variables, Tailwind configuration, and shadcn-compatible primitives from this design system when creating UI.",
  );

  return lines.join("\n");
}
