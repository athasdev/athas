/**
 * Sync highlight queries from pinned upstream tree-sitter repos.
 *
 * Usage:
 *   bun run scripts/sync-upstream-queries.ts
 *   bun run scripts/sync-upstream-queries.ts --check
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_DIR, EXTENSIONS_ROOT } from "./extension-workspace";

type Replacement = {
  find: string;
  replace: string;
};

type QuerySourceEntry = {
  repository: string;
  revision: string;
  queryPath: string;
  targetPath: string;
  overridePath?: string;
  replacements?: Replacement[];
};

type QuerySources = Record<string, QuerySourceEntry>;

const SOURCES_PATH = join(CATALOG_DIR, "query-sources.json");
const CHECK_MODE = process.argv.includes("--check");

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n");
}

function ensureTrailingNewline(input: string): string {
  return input.endsWith("\n") ? input : `${input}\n`;
}

function applyReplacements(content: string, replacements: Replacement[] | undefined): string {
  if (!replacements || replacements.length === 0) {
    return content;
  }

  let next = content;
  for (const replacement of replacements) {
    if (!next.includes(replacement.find)) {
      throw new Error(`Replacement target not found: ${replacement.find}`);
    }
    next = next.split(replacement.find).join(replacement.replace);
  }

  return next;
}

function buildRawUrl(entry: QuerySourceEntry): string {
  return `https://raw.githubusercontent.com/${entry.repository}/${entry.revision}/${entry.queryPath}`;
}

function buildGeneratedHeader(name: string, entry: QuerySourceEntry): string {
  return [
    "; AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY.",
    `; Source: https://github.com/${entry.repository}/blob/${entry.revision}/${entry.queryPath}`,
    `; Generator: scripts/sync-upstream-queries.ts (${name})`,
    "; Local customizations belong in highlights.override.scm.",
    "",
  ].join("\n");
}

function buildGeneratedQuery(
  name: string,
  entry: QuerySourceEntry,
  upstreamContent: string,
  overrideContent: string | null,
): string {
  const header = buildGeneratedHeader(name, entry);
  const upstream = ensureTrailingNewline(normalizeNewlines(upstreamContent)).trimEnd();

  if (!overrideContent || overrideContent.trim().length === 0) {
    return `${header}${upstream}\n`;
  }

  const normalizedOverride = ensureTrailingNewline(normalizeNewlines(overrideContent)).trimEnd();
  return `${header}${upstream}\n\n; --- Athas overrides ---\n${normalizedOverride}\n`;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function syncEntry(
  name: string,
  entry: QuerySourceEntry,
): Promise<{
  name: string;
  changed: boolean;
}> {
  const rawUrl = buildRawUrl(entry);
  const targetPath = join(EXTENSIONS_ROOT, entry.targetPath);
  const overridePath = entry.overridePath ? join(EXTENSIONS_ROOT, entry.overridePath) : null;

  const upstreamRaw = await fetchText(rawUrl);
  const patchedUpstream = applyReplacements(upstreamRaw, entry.replacements);
  const overrideContent =
    overridePath && existsSync(overridePath) ? await readFile(overridePath, "utf8") : null;

  const generated = buildGeneratedQuery(name, entry, patchedUpstream, overrideContent);
  const existing = existsSync(targetPath) ? await readFile(targetPath, "utf8") : "";
  const changed = normalizeNewlines(existing) !== normalizeNewlines(generated);

  if (CHECK_MODE) {
    if (changed) {
      throw new Error(
        `${name}: ${entry.targetPath} is out of date. Run: bun run scripts/sync-upstream-queries.ts`,
      );
    }
    return { name, changed: false };
  }

  if (changed) {
    await writeFile(targetPath, generated, "utf8");
  }

  return { name, changed };
}

async function main() {
  const rawConfig = await readFile(SOURCES_PATH, "utf8");
  const sources = JSON.parse(rawConfig) as QuerySources;

  const names = Object.keys(sources).sort();
  if (names.length === 0) {
    console.log("No query sources configured.");
    return;
  }

  const results = [];
  for (const name of names) {
    const result = await syncEntry(name, sources[name]);
    results.push(result);
    const label = CHECK_MODE ? "checked" : result.changed ? "updated" : "unchanged";
    console.log(`${name}: ${label}`);
  }

  if (CHECK_MODE) {
    console.log(`\nQuery sources check passed (${results.length} entries).`);
  } else {
    const updated = results.filter((entry) => entry.changed).length;
    console.log(`\nQuery sync complete (${updated}/${results.length} updated).`);
  }
}

await main();
