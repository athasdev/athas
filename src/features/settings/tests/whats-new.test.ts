import { describe, expect, it } from "vite-plus/test";
import { buildWhatsNewMarkdown, resolveWhatsNewInfo } from "../lib/whats-new";

describe("buildWhatsNewMarkdown", () => {
  it("uses bundled release notes when available", () => {
    const markdown = buildWhatsNewMarkdown({
      version: "1.2.0",
      previousVersion: "1.1.0",
      date: "2026-07-17",
      body: "Added workspace restore fixes.",
    });

    expect(markdown).toContain("title: What's New in Athas");
    expect(markdown).toContain("description: Version 1.2.0");
    expect(markdown).toContain("updated-from: 1.1.0");
    expect(markdown).toContain("released: July 17, 2026");
    expect(markdown).toContain("## Changes");
    expect(markdown).toContain("Added workspace restore fixes.");
  });

  it("formats generated GitHub entries as readable links", () => {
    const markdown = buildWhatsNewMarkdown({
      version: "1.2.0",
      body: [
        "* Improve updater layout by @athasdev in https://github.com/athasdev/athas/commit/abc123",
        "**Full Changelog**: https://github.com/athasdev/athas/compare/v1.1.0...v1.2.0",
      ].join("\n"),
    });

    expect(markdown).toContain(
      "- [Improve updater layout](https://github.com/athasdev/athas/commit/abc123) — @athasdev",
    );
    expect(markdown).toContain(
      "**Full changelog:** [Compare changes](https://github.com/athasdev/athas/compare/v1.1.0...v1.2.0)",
    );
    expect(markdown).not.toContain(" by @athasdev in https://");
  });

  it("includes a useful fallback when release notes are missing", () => {
    const markdown = buildWhatsNewMarkdown({ version: "1.2.0" });

    expect(markdown).toContain("Release notes were not bundled with this update.");
    expect(markdown).toContain("review the GitHub release page");
  });
});

describe("resolveWhatsNewInfo", () => {
  it("hydrates missing release notes from the current updater manifest", async () => {
    const fetchCalls: string[] = [];
    const fetchReleaseNotes = async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      return Response.json({
        version: "1.2.0",
        notes: "Fixed release notes.",
        pub_date: "2026-07-08T12:34:56Z",
      });
    };

    await expect(resolveWhatsNewInfo({ version: "1.2.0" }, fetchReleaseNotes)).resolves.toEqual({
      version: "1.2.0",
      body: "Fixed release notes.",
      date: "2026-07-08",
    });
    expect(fetchCalls).toEqual(["https://athas.dev/api/update/stable"]);
  });

  it("falls back to the GitHub release when the updater manifest is for another version", async () => {
    const fetchCalls: string[] = [];
    const fetchReleaseNotes = async (url: string | URL | Request) => {
      const href = String(url);
      fetchCalls.push(href);

      if (href.includes("athas.dev")) {
        return Response.json({ version: "1.3.0", notes: "Newer release." });
      }

      return Response.json({
        body: "Archived release notes.",
        published_at: "2026-07-07T09:00:00Z",
      });
    };

    await expect(resolveWhatsNewInfo({ version: "1.2.0" }, fetchReleaseNotes)).resolves.toEqual({
      version: "1.2.0",
      body: "Archived release notes.",
      date: "2026-07-07",
    });
    expect(fetchCalls).toEqual([
      "https://athas.dev/api/update/stable",
      "https://api.github.com/repos/athasdev/athas/releases/tags/v1.2.0",
    ]);
  });

  it("keeps the local fallback when release metadata cannot be fetched", async () => {
    const fetchReleaseNotes = async () => {
      throw new Error("offline");
    };

    await expect(resolveWhatsNewInfo({ version: "1.2.0" }, fetchReleaseNotes)).resolves.toEqual({
      version: "1.2.0",
    });
  });
});
