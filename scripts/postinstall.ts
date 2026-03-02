/**
 * Postinstall script — runs automatically after `bun install`
 *
 * 1. Installs LSP dependencies for bundled extensions
 * 2. Builds tree-sitter WASM parsers from source into public/tree-sitter/parsers/{lang}/parser.wasm
 *    using tree-sitter-cli and individual grammar packages
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
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

interface ParserSource {
  package: string;
  subdir?: string;
}

// All bundled parsers — built from source using tree-sitter-cli.
const BUNDLED_PARSERS: Record<string, ParserSource> = {
  bash: { package: "tree-sitter-bash" },
  c: { package: "tree-sitter-c" },
  c_sharp: { package: "tree-sitter-c-sharp" },
  cpp: { package: "tree-sitter-cpp" },
  css: { package: "tree-sitter-css" },
  dart: { package: "tree-sitter-dart" },
  elisp: { package: "tree-sitter-elisp" },
  elixir: { package: "tree-sitter-elixir" },
  go: { package: "tree-sitter-go" },
  html: { package: "tree-sitter-html" },
  java: { package: "tree-sitter-java" },
  javascript: { package: "tree-sitter-javascript" },
  json: { package: "tree-sitter-json" },
  kotlin: { package: "tree-sitter-kotlin" },
  lua: { package: "tree-sitter-lua" },
  markdown: { package: "@tree-sitter-grammars/tree-sitter-markdown", subdir: "tree-sitter-markdown" },
  objc: { package: "tree-sitter-objc" },
  ocaml: { package: "tree-sitter-ocaml", subdir: "grammars/ocaml" },
  php: { package: "tree-sitter-php", subdir: "php" },
  python: { package: "tree-sitter-python" },
  rescript: { package: "tree-sitter-rescript" },
  ruby: { package: "tree-sitter-ruby" },
  rust: { package: "tree-sitter-rust" },
  scala: { package: "tree-sitter-scala" },
  solidity: { package: "tree-sitter-solidity" },
  sql: { package: "@derekstride/tree-sitter-sql" },
  swift: { package: "tree-sitter-swift" },
  systemrdl: { package: "tree-sitter-systemrdl" },
  tlaplus: { package: "@tlaplus/tree-sitter-tlaplus" },
  toml: { package: "tree-sitter-toml" },
  tsx: { package: "tree-sitter-typescript", subdir: "tsx" },
  typescript: { package: "tree-sitter-typescript", subdir: "typescript" },
  vue: { package: "@tree-sitter-grammars/tree-sitter-vue" },
  yaml: { package: "@tree-sitter-grammars/tree-sitter-yaml" },
  zig: { package: "@tree-sitter-grammars/tree-sitter-zig" },
};

async function buildParserWasm(lang: string, source: ParserSource): Promise<boolean> {
  const packageDir = join(process.cwd(), "node_modules", source.package);
  if (!existsSync(packageDir)) {
    console.warn(`  Warning: ${source.package} not found in node_modules`);
    return false;
  }
  const destDir = join(PARSERS_DIR, lang);
  mkdirSync(destDir, { recursive: true });
  const outFile = join(destDir, "parser.wasm");
  const buildDir = source.subdir ? join(packageDir, source.subdir) : packageDir;
  console.log(`  Building ${lang}...`);
  try {
    await $`npx tree-sitter build --wasm -o ${outFile} ${buildDir}`.quiet();
  } catch (error) {
    console.warn(`  Warning: Failed to build ${lang} parser:`, error);
    return false;
  }
  if (!existsSync(outFile)) return false;
  // Copy highlights.scm if not already tracked (we have hand-edited versions)
  const highlightsDest = join(destDir, "highlights.scm");
  if (!existsSync(highlightsDest)) {
    const candidates = [
      join(packageDir, "queries", "highlights.scm"),
      ...(source.subdir ? [join(buildDir, "queries", "highlights.scm")] : []),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        await Bun.write(highlightsDest, Bun.file(candidate));
        break;
      }
    }
  }
  return true;
}

async function setupTreeSitterParsers() {
  console.log("Setting up tree-sitter parsers...");

  mkdirSync(PARSERS_DIR, { recursive: true });

  let built = 0;
  let skipped = 0;
  let failed = 0;

  for (const [lang, source] of Object.entries(BUNDLED_PARSERS)) {
    const destDir = join(PARSERS_DIR, lang);
    const destFile = join(destDir, "parser.wasm");

    mkdirSync(destDir, { recursive: true });

    // Skip if parser.wasm already exists
    if (existsSync(destFile)) {
      skipped++;
      continue;
    }

    const ok = await buildParserWasm(lang, source);
    if (ok) {
      built++;
    } else {
      failed++;
    }
  }

  console.log(
    `Tree-sitter setup complete: ${built} built, ${skipped} up-to-date, ${failed} failed`,
  );
}

// ─── Run ────────────────────────────────────────────────────────────

await installBundledLspDependencies();
await setupTreeSitterParsers();
