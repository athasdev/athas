import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const activityBarPath = fileURLToPath(
  new URL("../components/sidebar/activity-bar.tsx", import.meta.url),
);

describe("activity bar onboarding", () => {
  it("keeps the checklist directly below project dots and above footer utilities", () => {
    const source = readFileSync(activityBarPath, "utf8");
    const projectDotsIndex = source.indexOf("<ActivityProjectDots");
    const checklistIndex = source.indexOf("<OnboardingChecklist");
    const diagnosticsIndex = source.indexOf("<DiagnosticsActivityControl");

    expect(projectDotsIndex).toBeGreaterThan(-1);
    expect(checklistIndex).toBeGreaterThan(projectDotsIndex);
    expect(diagnosticsIndex).toBeGreaterThan(checklistIndex);
    expect(source).toContain("expanded={expanded}");
    expect(source).toContain("hasProject={Boolean(carouselProject)}");
  });
});
