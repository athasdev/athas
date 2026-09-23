#!/usr/bin/env bun
/**
 * Design-system drift report.
 *
 * Advisory only: this always exits 0. It exists to make drift visible in one
 * place instead of letting it accumulate across feature code. The rules mirror
 * the "UI Design System" section of AGENTS.md.
 *
 * Rules that already pass are enforced by @shadcn/lint in `vp check` (see the
 * lint block in vite.config.ts). This report covers what is not enforced yet:
 * the structural checks below, plus the wider @shadcn/lint policy from
 * design-advisory.json. Pass --all to list every finding.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { $, Glob } from "bun";

const ROOTS = ["src/features", "src/extensions", "src/components"];

/** Menu surfaces whose scroll cap is owned by the `viewport` variant. */
const MENU_SURFACES = new Set(["DropdownMenuContent", "DropdownMenuSubContent"]);

/** Fixed pixel sizes. Lint treats h-/w- as layout, so they are only reported here. */
const ARBITRARY_SIZE = /\b(?:h|w)-\[[\d.]+(?:px|rem)\]/g;
const RAW_HEX = /(?<![\w&])#[0-9a-fA-F]{6}\b/g;
/**
 * A theme color with an opacity modifier. The token layer already carries the
 * tinted and de-emphasised steps (`*-soft`, the text ramp, `focus`), so an
 * ad-hoc alpha is a private colour the theme cannot control.
 */
const ALPHA_COLOR =
  /\b(?:bg|text|border|ring|outline|divide|from|via|to|fill|stroke|shadow|placeholder)-(?:background|surface|overlay|foreground|muted-foreground|subtle-foreground|border|border-strong|accent|selected|primary|destructive|success|warning|info|git-[a-z-]+)\/\d+\b/g;

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

  for (const tag of findOpeningTags(source, MENU_SURFACES)) {
    const line = lineOf(source, tag.index);
    // A search header only sticks, and only scrolls correctly, inside the
    // searchable viewport. Getting this wrong is silent, so check it here.
    if (
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
        detail: `"${m[0]}" — size it from content, the spacing scale, or a primitive prop.`,
      });
    }
    for (const m of text.matchAll(ALPHA_COLOR)) {
      findings.push({
        file,
        line: i + 1,
        rule: "alpha-color",
        detail: `"${m[0]}" — use the token's semantic step instead (a *-soft fill, the text ramp, ring-focus).`,
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

/** The wider @shadcn/lint policy that is not enforced yet. */
async function lintFindings(): Promise<Finding[]> {
  // The oxlint that Vite+ runs for `vp lint`, so both see the same version.
  const vitePlus = path.dirname(Bun.resolveSync("vite-plus/package.json", process.cwd()));
  const oxlint = path.join(
    path.dirname(Bun.resolveSync("oxlint/package.json", vitePlus)),
    "bin/oxlint",
  );
  const config = path.join(import.meta.dir, "design-advisory.json");
  const output = await $`${oxlint} -c ${config} -A all -f json ${ROOTS}`.nothrow().quiet().text();
  const { diagnostics } = JSON.parse(output) as {
    diagnostics: {
      code: string;
      filename: string;
      message: string;
      labels: { span: { line: number } }[];
    }[];
  };
  return diagnostics
    .filter((item) => !item.filename.includes("/tests/") && !item.filename.endsWith(".test.tsx"))
    .map((item) => ({
      file: item.filename,
      line: item.labels[0]?.span.line ?? 1,
      rule: item.code.replace(/^shadcn\((.+)\)$/, "$1"),
      detail: item.message.split(". See ")[0],
    }));
}

findings.push(...(await lintFindings()));

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
  const shown = process.argv.includes("--all") ? bucket : bucket.slice(0, 20);
  for (const finding of shown) {
    console.log(`    ${finding.file}:${finding.line}  ${finding.detail}`);
  }
  if (shown.length < bucket.length) {
    console.log(`    … ${bucket.length - shown.length} more (bun check:design --all)`);
  }
  console.log("");
}
console.log("Advisory only — this check does not fail the build.");
process.exit(0);
