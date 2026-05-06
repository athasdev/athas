import { describe, expect, it } from "vite-plus/test";
import { buildWhatsNewMarkdown } from "../lib/whats-new";

describe("buildWhatsNewMarkdown", () => {
  it("uses bundled release notes when available", () => {
    expect(
      buildWhatsNewMarkdown({
        version: "1.2.0",
        previousVersion: "1.1.0",
        body: "Added workspace restore fixes.",
      }),
    ).toContain("Added workspace restore fixes.");
  });

  it("includes a useful fallback when release notes are missing", () => {
    const markdown = buildWhatsNewMarkdown({ version: "1.2.0" });

    expect(markdown).toContain("Release notes were not bundled with this update.");
    expect(markdown).toContain("review the GitHub release page");
  });
});
