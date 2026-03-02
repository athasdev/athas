/**
 * Postinstall script — runs automatically after `bun install`
 *
 * 1. Installs LSP dependencies for bundled extensions
 * 2. Copies tree-sitter WASM parsers into public/tree-sitter/parsers/{lang}/parser.wasm
 *    - Most parsers come from the tree-sitter-wasms npm package
 *    - Parsers not in that package are downloaded from GitHub releases
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

// ─── LSP Dependencies ───────────────────────────────────────────────

const BUNDLED_EXTENSIONS_DIR = "src/extensions/bundled";

async function installBundledLspDependencies() {
  console.log("Installing bundled extension LSP dependencies...");

  const bundledDir = join(process.cwd(), BUNDLED_EXTENSIONS_DIR);

  if (!existsSync(bundledDir)) {
    console.log("No bundled extensions directory found, skipping.");
    return;
  }

  const entries = readdirSync(bundledDir, { withFileTypes: true });

  for (const ext of entries) {
    if (!ext.isDirectory()) continue;

    const lspDir = join(bundledDir, ext.name, "lsp");
    const packageJson = join(lspDir, "package.json");

    if (existsSync(packageJson)) {
      console.log(`  Installing LSP for ${ext.name}...`);
      try {
        await $`cd ${lspDir} && bun install`.quiet();
        console.log(`  Installed ${ext.name} LSP dependencies`);
      } catch (error) {
        console.error(`  Failed to install ${ext.name} LSP:`, error);
      }
    }
  }

  console.log("Bundled LSP installation complete.\n");
}

// ─── Tree-sitter Parsers ────────────────────────────────────────────

const PARSERS_DIR = join(process.cwd(), "public/tree-sitter/parsers");
const WASMS_DIR = join(process.cwd(), "node_modules/tree-sitter-wasms/out");

type ParserSource =
  | { type: "npm" }
  | { type: "github"; repo: string; tag: string; asset: string };

// All bundled parsers and where to get their WASM from.
// Most come from tree-sitter-wasms npm package, some from GitHub releases.
const BUNDLED_PARSERS: Record<string, ParserSource> = {
  bash: { type: "npm" },
  c: { type: "npm" },
  c_sharp: { type: "npm" },
  cpp: { type: "npm" },
  css: { type: "npm" },
  dart: { type: "npm" },
  elisp: { type: "npm" },
  elixir: { type: "npm" },
  go: { type: "npm" },
  html: { type: "npm" },
  java: { type: "npm" },
  javascript: { type: "npm" },
  json: { type: "npm" },
  kotlin: { type: "npm" },
  lua: { type: "npm" },
  markdown: {
    type: "github",
    repo: "tree-sitter-grammars/tree-sitter-markdown",
    tag: "v0.5.3",
    asset: "tree-sitter-markdown.wasm",
  },
  objc: { type: "npm" },
  ocaml: { type: "npm" },
  php: { type: "npm" },
  python: { type: "npm" },
  rescript: { type: "npm" },
  ruby: { type: "npm" },
  rust: { type: "npm" },
  scala: { type: "npm" },
  solidity: { type: "npm" },
  swift: { type: "npm" },
  systemrdl: { type: "npm" },
  tlaplus: { type: "npm" },
  toml: { type: "npm" },
  tsx: { type: "npm" },
  typescript: { type: "npm" },
  vue: { type: "npm" },
  yaml: { type: "npm" },
  zig: { type: "npm" },
};

async function resolveParserWasm(lang: string, source: ParserSource): Promise<Uint8Array | null> {
  if (source.type === "npm") {
    const srcFile = join(WASMS_DIR, `tree-sitter-${lang}.wasm`);
    if (!existsSync(srcFile)) {
      console.warn(`  Warning: tree-sitter-${lang}.wasm not found in tree-sitter-wasms`);
      return null;
    }
    return new Uint8Array(await Bun.file(srcFile).arrayBuffer());
  }

  const url = `https://github.com/${source.repo}/releases/download/${source.tag}/${source.asset}`;
  console.log(`  Downloading ${lang} parser...`);
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`  Warning: Failed to download ${lang} parser (${response.status})`);
    return null;
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function setupTreeSitterParsers() {
  console.log("Setting up tree-sitter parsers...");

  if (!existsSync(WASMS_DIR)) {
    console.error("tree-sitter-wasms not found in node_modules. Run `bun install` first.");
    process.exit(1);
  }

  mkdirSync(PARSERS_DIR, { recursive: true });

  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const [lang, source] of Object.entries(BUNDLED_PARSERS)) {
    const destDir = join(PARSERS_DIR, lang);
    const destFile = join(destDir, "parser.wasm");

    mkdirSync(destDir, { recursive: true });

    // For npm sources, skip if destination matches source size
    if (source.type === "npm" && existsSync(destFile)) {
      const srcFile = join(WASMS_DIR, `tree-sitter-${lang}.wasm`);
      try {
        if (existsSync(srcFile) && statSync(srcFile).size === statSync(destFile).size) {
          skipped++;
          continue;
        }
      } catch {
        // If stat fails, just re-copy
      }
    }

    // For GitHub sources, skip if already downloaded
    if (source.type === "github" && existsSync(destFile)) {
      skipped++;
      continue;
    }

    const data = await resolveParserWasm(lang, source);
    if (!data) {
      failed++;
      continue;
    }

    await Bun.write(destFile, data);
    copied++;
  }

  console.log(
    `Tree-sitter setup complete: ${copied} copied, ${skipped} up-to-date, ${failed} failed`,
  );
}

// ─── Run ────────────────────────────────────────────────────────────

await installBundledLspDependencies();
await setupTreeSitterParsers();
