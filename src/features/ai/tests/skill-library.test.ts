import { describe, expect, it } from "vite-plus/test";
import {
  createSkillFromMarketplace,
  hasMarketplaceSkillUpdate,
  hasSkillLocalOverride,
  isMarketplaceSkillInstalled,
  resetSkillLocalOverride,
  updateSkillFromMarketplace,
} from "@/features/ai/lib/skill-library";

describe("skill library", () => {
  it("creates installable AI chat skills from marketplace entries", () => {
    const skill = createSkillFromMarketplace({
      id: "athas.review",
      title: "Review",
      description: "Review code changes",
      content: "Review this diff carefully.",
      author: "Athas",
      version: "1.0.0",
      tags: ["review"],
    });

    expect(skill).toMatchObject({
      title: "Review",
      description: "Review code changes",
      content: "Review this diff carefully.",
      author: "Athas",
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
