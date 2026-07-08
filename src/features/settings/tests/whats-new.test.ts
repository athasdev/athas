import { describe, expect, it } from "vite-plus/test";
import { buildWhatsNewMarkdown, resolveWhatsNewInfo } from "../lib/whats-new";

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

    await expect(
      resolveWhatsNewInfo({ version: "1.2.0" }, fetchReleaseNotes),
    ).resolves.toEqual({
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

    await expect(
      resolveWhatsNewInfo({ version: "1.2.0" }, fetchReleaseNotes),
    ).resolves.toEqual({
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

    await expect(
      resolveWhatsNewInfo({ version: "1.2.0" }, fetchReleaseNotes),
    ).resolves.toEqual({ version: "1.2.0" });
  });
});
