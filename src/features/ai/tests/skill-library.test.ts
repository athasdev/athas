import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createSkillFromMarketplace,
  hasMarketplaceSkillUpdate,
  hasSkillLocalOverride,
  isMarketplaceSkillInstalled,
  loadMarketplaceSkills,
  resetSkillLocalOverride,
  resolveMarketplaceSkill,
  updateSkillFromMarketplace,
} from "@/features/ai/lib/skill-library";

describe("skill library", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads marketplace summaries without fetching every skill body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          "skills/review": {
            id: "athas.skill.review",
            name: "review",
            displayName: "Review",
            description: "Review code changes",
            version: "1.0.0",
            publisher: "Athas",
            license: "MIT",
            categories: ["Skill"],
            contributes: {
              skills: [
                {
                  id: "athas.review",
                  name: "Review",
                  description: "Review code changes",
                  path: "SKILL.md",
                },
              ],
            },
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadMarketplaceSkills()).resolves.toEqual([
      expect.objectContaining({
        id: "athas.review",
        title: "Review",
        detailUrl: "https://athas.dev/extensions/skills/review/SKILL.md",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves raw SKILL.md instructions from extension packages", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            "---\nname: review\ndescription: Review code changes\n---\n\nReview this diff carefully.",
          ),
        ),
    );

    await expect(
      resolveMarketplaceSkill({
        id: "athas.review",
        title: "Review",
        description: "Review code changes",
        detailUrl: "https://athas.dev/extensions/skills/review/SKILL.md",
        tags: [],
      }),
    ).resolves.toMatchObject({
      content: "Review this diff carefully.",
    });
  });

  it("resolves marketplace instructions only when requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "skills-sh:review",
          title: "Review",
          description: "Review code changes",
          content: "Review this diff carefully.",
          version: "abc123",
          tags: ["review"],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveMarketplaceSkill({
        id: "skills-sh:review",
        title: "Review",
        description: "Review code changes",
        detailUrl: "https://athas.dev/api/skills/details/review",
        tags: ["skills.sh"],
      }),
    ).resolves.toMatchObject({
      content: "Review this diff carefully.",
      version: "abc123",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://athas.dev/api/skills/details/review");
  });

  it("creates installable Agent skills from marketplace entries", () => {
    const skill = createSkillFromMarketplace({
      id: "athas.review",
      title: "Review",
      description: "Review code changes",
      content: "Review this diff carefully.",
      author: "Athas",
      license: "MIT",
      sourceUrl: "https://github.com/athasdev/athas",
      version: "1.0.0",
      tags: ["review"],
    });

    expect(skill).toMatchObject({
      title: "Review",
      description: "Review code changes",
      content: "Review this diff carefully.",
      author: "Athas",
      license: "MIT",
      sourceUrl: "https://github.com/athasdev/athas",
      source: "marketplace",
      sourceId: "athas.review",
      version: "1.0.0",
      tags: ["review"],
      localOverride: false,
      upstreamTitle: "Review",
      upstreamDescription: "Review code changes",
      upstreamContent: "Review this diff carefully.",
    });
  });

  it("detects installed marketplace skills by source id", () => {
    const installed = createSkillFromMarketplace({
      id: "athas.review",
      title: "Review",
      description: "Review code changes",
      content: "Review this diff carefully.",
      tags: [],
    });

    expect(isMarketplaceSkillInstalled([installed], "athas.review")).toBe(true);
    expect(isMarketplaceSkillInstalled([installed], "athas.other")).toBe(false);
  });

  it("updates untouched marketplace skills in place", () => {
    const installed = createSkillFromMarketplace({
      id: "athas.review",
      title: "Review",
      description: "Review code changes",
      content: "Review this diff carefully.",
      version: "1.0.0",
      tags: ["review"],
    });
    const nextMarketplaceSkill = {
      id: "athas.review",
      title: "Review v2",
      description: "Review code changes with tests",
      content: "Review this diff and test coverage carefully.",
      version: "1.1.0",
      tags: ["review", "testing"],
    };

    expect(hasMarketplaceSkillUpdate(installed, nextMarketplaceSkill)).toBe(true);

    const updated = updateSkillFromMarketplace(installed, nextMarketplaceSkill);

    expect(updated).toMatchObject({
      title: "Review v2",
      description: "Review code changes with tests",
      content: "Review this diff and test coverage carefully.",
      version: "1.1.0",
      localOverride: false,
      upstreamTitle: "Review v2",
      upstreamContent: "Review this diff and test coverage carefully.",
    });
    expect(hasMarketplaceSkillUpdate(updated, nextMarketplaceSkill)).toBe(false);
  });

  it("keeps local overrides when marketplace skills update", () => {
    const installed = {
      ...createSkillFromMarketplace({
        id: "athas.review",
        title: "Review",
        description: "Review code changes",
        content: "Review this diff carefully.",
        version: "1.0.0",
        tags: ["review"],
      }),
      title: "My Review",
      content: "Use my project review checklist.",
      localOverride: true,
    };
    const nextMarketplaceSkill = {
      id: "athas.review",
      title: "Review v2",
      description: "Review code changes with tests",
      content: "Review this diff and test coverage carefully.",
      version: "1.1.0",
      tags: ["review", "testing"],
    };

    const updated = updateSkillFromMarketplace(installed, nextMarketplaceSkill);

    expect(updated).toMatchObject({
      title: "My Review",
      content: "Use my project review checklist.",
      version: "1.1.0",
      localOverride: true,
      upstreamTitle: "Review v2",
      upstreamContent: "Review this diff and test coverage carefully.",
    });
    expect(hasSkillLocalOverride(updated)).toBe(true);

    const reset = resetSkillLocalOverride(updated);

    expect(reset).toMatchObject({
      title: "Review v2",
      content: "Review this diff and test coverage carefully.",
      localOverride: false,
    });
  });
});
