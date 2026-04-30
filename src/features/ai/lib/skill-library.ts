import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills";

const SKILLS_REGISTRY_URL =
  import.meta.env.VITE_SKILLS_REGISTRY_URL || "https://athas.dev/skills/index.json";

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
  if (!content) return null;

  const id =
    asString(entry.id) ||
    asString(entry.slug) ||
    `skill.${createSkillSlug(title) || Math.random().toString(36).slice(2, 9)}`;

  return {
    id,
    title,
    description:
      asString(entry.description) ||
      content.replace(/\s+/g, " ").trim().slice(0, 160) ||
      "Reusable AI chat instructions.",
    content,
    author: asString(entry.author) || asString(entry.publisher),
    version: asString(entry.version),
    tags: asStringArray(entry.tags),
    sourceUrl:
      asString(entry.sourceUrl) ||
      asString(entry.url) ||
      asString(entry.manifestUrl) ||
      asString(entry.contentUrl),
    updatedAt: asString(entry.updatedAt) || asString(entry.updated_at),
  };
}

async function fetchSkillDetail(entry: SkillRegistryEntry): Promise<SkillRegistryEntry> {
  if (asString(entry.content) || asString(entry.instructions) || asString(entry.prompt)) {
    return entry;
  }

  const detailUrl =
    asString(entry.manifestUrl) || asString(entry.contentUrl) || asString(entry.sourceUrl);
  if (!detailUrl) return entry;

  try {
    const response = await fetch(detailUrl);
    if (!response.ok) return entry;
    const detail = (await response.json()) as SkillRegistryEntry;
    return { ...entry, ...detail };
  } catch {
    return entry;
  }
}

export async function loadMarketplaceSkills(): Promise<MarketplaceSkill[]> {
  try {
    const response = await fetch(SKILLS_REGISTRY_URL);
    if (!response.ok) return [];

    const payload = (await response.json()) as unknown;
    const entries = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { skills?: unknown }).skills)
        ? (payload as { skills: unknown[] }).skills
        : [];

    const detailedEntries = await Promise.all(
      entries
        .filter((entry): entry is SkillRegistryEntry => Boolean(entry) && typeof entry === "object")
        .map((entry) => fetchSkillDetail(entry)),
    );

    const seen = new Set<string>();
    return detailedEntries
      .map(normalizeMarketplaceSkill)
      .filter((skill): skill is MarketplaceSkill => {
        if (!skill || seen.has(skill.id)) return false;
        seen.add(skill.id);
        return true;
      });
  } catch {
    return [];
  }
}

export function isMarketplaceSkillInstalled(skills: AIChatSkill[], marketplaceSkillId: string) {
  return skills.some(
    (skill) => skill.sourceId === marketplaceSkillId || skill.id === marketplaceSkillId,
  );
}

export function findInstalledMarketplaceSkill(
  skills: AIChatSkill[],
  marketplaceSkillId: string,
): AIChatSkill | undefined {
  return skills.find(
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

  if (
    installed.version !== marketplace.version &&
    Boolean(installed.version || marketplace.version)
  ) {
    return true;
  }

  if (
    installed.upstreamUpdatedAt !== marketplace.updatedAt &&
    Boolean(installed.upstreamUpdatedAt && marketplace.updatedAt)
  ) {
    return true;
  }

  return (
    getInstalledUpstreamTitle(installed) !== marketplace.title ||
    getInstalledUpstreamContent(installed) !== marketplace.content ||
    getInstalledUpstreamDescription(installed) !== marketplace.description
  );
}

export function createSkillFromMarketplace(skill: MarketplaceSkill): AIChatSkill {
  const now = new Date().toISOString();

  return {
    id: `skill-${skill.id.replace(/[^a-zA-Z0-9._-]+/g, "-")}-${Date.now()}`,
    title: skill.title,
    description: skill.description,
    content: skill.content,
    author: skill.author,
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
  marketplace: MarketplaceSkill,
): AIChatSkill {
  const now = new Date().toISOString();
  const localOverride = hasSkillLocalOverride(installed);

  return {
    ...installed,
    title: localOverride ? installed.title : marketplace.title,
    description: marketplace.description,
    content: localOverride ? installed.content : marketplace.content,
    author: marketplace.author,
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
