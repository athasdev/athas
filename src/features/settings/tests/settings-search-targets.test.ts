import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { settingsSearchIndex } from "../config/search-index";
import { getSettingSearchTargetKey } from "../lib/settings-search";

const featuresDirectory = fileURLToPath(new URL("../../", import.meta.url));

// Settings pages are built from these folders; sections outside them never render in Settings.
const settingsSourceRoots = [
  "settings/components",
  "sharing/components/sharing-settings.tsx",
  "ai/components/mcp/mcp-server-settings.tsx",
  "ai/components/permissions/agent-allowed-actions-settings.tsx",
  "ai/integrations/codex/codex-settings.tsx",
];

function collectSources(path: string): string[] {
  if (statSync(path).isFile()) return [readFileSync(path, "utf8")];
  return readdirSync(path).flatMap((name) => collectSources(join(path, name)));
}

const sources = settingsSourceRoots.flatMap((root) =>
  collectSources(join(featuresDirectory, root)),
);
const renderedSectionKeys = new Set(
  sources.flatMap((source) =>
    [
      ...source.matchAll(/<Section\s+title="([^"]+)"/g),
      ...source.matchAll(/SECTION_TITLE = "([^"]+)"/g),
    ].map((match) => getSettingSearchTargetKey(match[1] ?? "")),
  ),
);
// Provider sections are titled by the provider's name at runtime.
const dynamicSectionTabs = new Set(["ai-models", "collaboration"]);

describe("settings search targets", () => {
  it("points every search result at a section that Settings renders", () => {
    const missing = settingsSearchIndex
      .filter((record) => !dynamicSectionTabs.has(record.tab))
      .filter((record) => !renderedSectionKeys.has(getSettingSearchTargetKey(record.section)))
      .map((record) => `${record.id}: ${record.section}`);

    expect(missing).toEqual([]);
  });
});
