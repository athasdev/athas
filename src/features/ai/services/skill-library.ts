import type {
  AIChatSkill,
  MarketplaceSkill,
  ResolvedMarketplaceSkill,
} from "@/features/ai/types/skills.types";
import { loadMarketplaceSkillContributions } from "@/extensions/marketplace/marketplace-skills";

type SkillRegistryEntry = Record<string, unknown>;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function createSkillSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeMarketplaceSkill(entry: SkillRegistryEntry): MarketplaceSkill | null {
  const title = asString(entry.title) || asString(entry.name) || asString(entry.displayName);
  if (!title) return null;

  const content =
    asString(entry.content) ||
    asString(entry.instructions) ||
    asString(entry.prompt) ||
    asString(entry.body);
  const detailUrl =
    asString(entry.detailUrl) || asString(entry.manifestUrl) || asString(entry.contentUrl);
  if (!content && !detailUrl) return null;

  const id =
    asString(entry.id) ||
    asString(entry.slug) ||
    `skill.${createSkillSlug(title) || Math.random().toString(36).slice(2, 9)}`;

  return {
    id,
    title,
    description:
      asString(entry.description) ||
      content?.replace(/\s+/g, " ").trim().slice(0, 160) ||
      "Reusable Agent instructions.",
    content,
    author: asString(entry.author) || asString(entry.publisher),
    license: asString(entry.license),
    version: asString(entry.version),
    tags: asStringArray(entry.tags),
    detailUrl,
    sourceUrl: asString(entry.sourceUrl) || asString(entry.url),
    updatedAt: asString(entry.updatedAt) || asString(entry.updated_at),
  };
}

export async function loadMarketplaceSkills(): Promise<MarketplaceSkill[]> {
  try {
    const seen = new Set<string>();
    return (await loadMarketplaceSkillContributions()).filter(
      (skill): skill is MarketplaceSkill => {
        if (seen.has(skill.id)) return false;
        seen.add(skill.id);
        return true;
      },
    );
  } catch {
    return [];
  }
}

export async function resolveMarketplaceSkill(
  skill: MarketplaceSkill,
): Promise<ResolvedMarketplaceSkill> {
  if (skill.content?.trim()) {
    return { ...skill, content: skill.content };
  }

  if (!skill.detailUrl) {
    throw new Error(`${skill.title} does not provide installable instructions`);
  }

  const response = await fetch(skill.detailUrl);
  if (!response.ok) {
    throw new Error(`Could not load ${skill.title} (${response.status})`);
  }

  const body = await response.text();
  let detail: SkillRegistryEntry;
  try {
    detail = JSON.parse(body) as SkillRegistryEntry;
  } catch {
    const content = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    detail = { content };
  }

  const resolved = normalizeMarketplaceSkill({ ...skill, ...detail });
  if (!resolved?.content) {
    throw new Error(`${skill.title} does not provide installable instructions`);
  }

  return { ...resolved, content: resolved.content };
}

export function isMarketplaceSkillInstalled(skills: AIChatSkill[], marketplaceSkillId: string) {
  return skills.some(
    (skill) => skill.sourceId === marketplaceSkillId || skill.id === marketplaceSkillId,
  );
}

function getInstalledUpstreamTitle(skill: AIChatSkill) {
  return skill.upstreamTitle ?? skill.title;
}

function getInstalledUpstreamContent(skill: AIChatSkill) {
  return skill.upstreamContent ?? skill.content;
}

function getInstalledUpstreamDescription(skill: AIChatSkill) {
  return skill.upstreamDescription ?? skill.description;
}

export function hasSkillLocalOverride(skill: AIChatSkill) {
  if (skill.source !== "marketplace") return false;

  return Boolean(
    skill.localOverride ||
    skill.title !== getInstalledUpstreamTitle(skill) ||
    skill.content !== getInstalledUpstreamContent(skill),
  );
}

export function hasMarketplaceSkillUpdate(installed: AIChatSkill, marketplace: MarketplaceSkill) {
  if (installed.source !== "marketplace") return false;

  if (marketplace.version && installed.version !== marketplace.version) {
    return true;
  }

  if (marketplace.updatedAt && installed.upstreamUpdatedAt !== marketplace.updatedAt) {
    return true;
  }

  return (
    getInstalledUpstreamTitle(installed) !== marketplace.title ||
    getInstalledUpstreamDescription(installed) !== marketplace.description ||
    (marketplace.content !== undefined &&
      getInstalledUpstreamContent(installed) !== marketplace.content)
  );
}

export function createSkillFromMarketplace(skill: ResolvedMarketplaceSkill): AIChatSkill {
  const now = new Date().toISOString();

  return {
    id: `skill-${skill.id.replace(/[^a-zA-Z0-9._-]+/g, "-")}-${Date.now()}`,
    title: skill.title,
    description: skill.description,
    content: skill.content,
    author: skill.author,
    license: skill.license,
    sourceUrl: skill.sourceUrl,
    source: "marketplace",
    sourceId: skill.id,
    version: skill.version,
    tags: skill.tags,
    localOverride: false,
    upstreamTitle: skill.title,
    upstreamDescription: skill.description,
    upstreamContent: skill.content,
    upstreamUpdatedAt: skill.updatedAt,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateSkillFromMarketplace(
  installed: AIChatSkill,
  marketplace: ResolvedMarketplaceSkill,
): AIChatSkill {
  const now = new Date().toISOString();
  const localOverride = hasSkillLocalOverride(installed);

  return {
    ...installed,
    title: localOverride ? installed.title : marketplace.title,
    description: marketplace.description,
    content: localOverride ? installed.content : marketplace.content,
    author: marketplace.author,
    license: marketplace.license,
    sourceUrl: marketplace.sourceUrl,
    source: "marketplace",
    sourceId: marketplace.id,
    version: marketplace.version,
    tags: marketplace.tags,
    localOverride,
    upstreamTitle: marketplace.title,
    upstreamDescription: marketplace.description,
    upstreamContent: marketplace.content,
    upstreamUpdatedAt: marketplace.updatedAt,
    updatedAt: now,
  };
}

export function resetSkillLocalOverride(skill: AIChatSkill): AIChatSkill {
  if (skill.source !== "marketplace") {
    return skill;
  }

  const now = new Date().toISOString();

  return {
    ...skill,
    title: skill.upstreamTitle ?? skill.title,
    description: skill.upstreamDescription ?? skill.description,
    content: skill.upstreamContent ?? skill.content,
    localOverride: false,
    updatedAt: now,
  };
}
