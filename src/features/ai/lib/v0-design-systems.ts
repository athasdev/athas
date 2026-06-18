import type { Settings } from "@/features/settings/types/settings.types";
import type { V0DesignSystemProfile } from "@/features/ai/types/v0-design-system.types";

const MAX_V0_DESIGN_SYSTEMS = 50;
const MAX_FIELD_LENGTH = 500;

const V0_DESIGN_SYSTEM_PROMPT_PREFIX = "Use this design system for generated UI:";

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
      const tailwindConfigPath = trimOptional(candidate.tailwindConfigPath);
      const globalsCssPath = trimOptional(candidate.globalsCssPath);
      const componentsJsonPath = trimOptional(candidate.componentsJsonPath);

      return {
        id,
        name,
        registryUrl,
        ...(description ? { description } : {}),
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
