#!/usr/bin/env bun
/**
 * Design-system drift report.
 *
 * Advisory only: this always exits 0. It exists to make drift visible in one
 * place instead of letting it accumulate across feature code. The rules mirror
 * the "UI Design System" section of AGENTS.md.
 */
import { readFileSync } from "node:fs";
import { Glob } from "bun";

const ROOTS = ["src/features", "src/extensions", "src/components"];

/** Overlay surfaces whose width is owned by the `size` preset (@/ui/overlay-size). */
const OVERLAY_SURFACES = new Set([
  "DropdownMenuContent",
  "DropdownMenuSubContent",
  "PopoverContent",
  "PopoverListContent",
  "SelectContent",
  "ComboboxContent",
]);

/** Menu surfaces whose scroll cap is owned by the `viewport` variant. */
const MENU_SURFACES = new Set(["DropdownMenuContent", "DropdownMenuSubContent"]);

const WIDTH_UTILITY = /(?:^|\s)(?:min-|max-)?w-(?!full\b|fit\b|auto\b|0\b)[\w./[\]()-]+/;
const HEIGHT_UTILITY = /(?:^|\s)max-h-[\w./[\]()-]+/;
const ARBITRARY_SIZE = /\b(?:text|h|w|gap|p[xytblr]?)-\[[\d.]+(?:px|rem)\]/g;
const RAW_HEX = /(?<![\w&])#[0-9a-fA-F]{6}\b/g;

interface Finding {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

/**
 * Returns the attribute text of every opening tag for `names`, tracking quotes
 * and brace depth so a `>` inside an arrow function or generic does not end the
 * tag early.
 */
function findOpeningTags(source: string, names: Set<string>) {
  const tags: { name: string; attrs: string; index: number; body: string }[] = [];
  const tagStart = /<([A-Z][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;

  while ((match = tagStart.exec(source))) {
    const name = match[1];
    if (!names.has(name)) continue;

    let i = tagStart.lastIndex;
    let depth = 0;
    let quote: string | null = null;

    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote && source[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }

    const attrs = source.slice(tagStart.lastIndex, i);
    tags.push({
      name,
      attrs,
      index: match.index,
      body: attrs.trimEnd().endsWith("/") ? "" : bodyOf(source, name, i + 1),
    });
  }

  return tags;
}

/**
 * Drops nested menu surfaces from a body, so a search input belonging to a
 * submenu is not attributed to the menu that contains it.
 */
function ownBody(body: string) {
  let result = "";
  let i = 0;

  while (i < body.length) {
    const next = /<(DropdownMenuSubContent|DropdownMenuContent)[\s/>]/.exec(body.slice(i));
    if (!next) return result + body.slice(i);
    const start = i + next.index;
    result += body.slice(i, start);
    const open = body.indexOf(">", start);
    if (open === -1) return result;
    i = open + 1 + bodyOf(body, next[1], open + 1).length;
    const close = body.indexOf(">", i);
    i = close === -1 ? body.length : close + 1;
  }

  return result;
}

/** Text between an opening tag that ends at `from` and its matching close tag. */
function bodyOf(source: string, name: string, from: number) {
  const token = new RegExp(`<(/?)${name}[\\s/>]`, "g");
  token.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = token.exec(source))) {
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return source.slice(from, match.index);
  }

  return source.slice(from);
}

function lineOf(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

function checkFile(file: string, findings: Finding[]) {
  const source = readFileSync(file, "utf8");

  for (const tag of findOpeningTags(source, OVERLAY_SURFACES)) {
    const line = lineOf(source, tag.index);
    const className = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(tag.attrs);
    const value = className?.[1] ?? className?.[2];

    if (value) {
      const width = WIDTH_UTILITY.exec(value);
      if (width) {
        findings.push({
          file,
          line,
          rule: "overlay-width",
          detail: `<${tag.name}> sets "${width[0].trim()}" — use the size preset instead (@/ui/overlay-size).`,
        });
      }

      const height = MENU_SURFACES.has(tag.name) ? HEIGHT_UTILITY.exec(value) : null;
      if (height) {
        findings.push({
          file,
          line,
          rule: "overlay-height",
          detail: `<${tag.name}> sets "${height[0].trim()}" — use viewport="list" or viewport="searchable", which own the scroll cap.`,
        });
      }
    }

    // A search header only sticks, and only scrolls correctly, inside the
    // searchable viewport. Getting this wrong is silent, so check it here.
    if (
      MENU_SURFACES.has(tag.name) &&
      ownBody(tag.body).includes("<DropdownMenuSearch") &&
      !/viewport=(?:"searchable"|\{"searchable"\})/.test(tag.attrs)
    ) {
      findings.push({
        file,
        line,
        rule: "unsearchable-viewport",
        detail: `<${tag.name}> holds a DropdownMenuSearch but is not viewport="searchable" — the search header will not stick.`,
      });
    }
  }

  source.split("\n").forEach((text, i) => {
    for (const m of text.matchAll(ARBITRARY_SIZE)) {
      findings.push({
        file,
        line: i + 1,
        rule: "arbitrary-size",
        detail: `"${m[0]}" — use a token-backed utility (ui-text-*, spacing scale).`,
      });
    }
    for (const m of text.matchAll(RAW_HEX)) {
      findings.push({
        file,
        line: i + 1,
        rule: "raw-color",
        detail: `"${m[0]}" — use a semantic color token from src/styles/theme.css.`,
      });
    }
  });
}

const findings: Finding[] = [];
for (const root of ROOTS) {
  for (const file of new Glob("**/*.tsx").scanSync({ cwd: root })) {
    if (file.includes("/tests/") || file.endsWith(".test.tsx")) continue;
    checkFile(`${root}/${file}`, findings);
  }
}

if (findings.length === 0) {
  console.log("design-system: no drift found");
  process.exit(0);
}

const byRule = new Map<string, Finding[]>();
for (const finding of findings) {
  const bucket = byRule.get(finding.rule) ?? [];
  bucket.push(finding);
  byRule.set(finding.rule, bucket);
}

console.log(`design-system: ${findings.length} advisory finding(s)\n`);
for (const [rule, bucket] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${rule} (${bucket.length})`);
  for (const finding of bucket) {
    console.log(`    ${finding.file}:${finding.line}  ${finding.detail}`);
  }
  console.log("");
}
console.log("Advisory only — this check does not fail the build.");
process.exit(0);
