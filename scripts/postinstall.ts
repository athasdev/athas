/**
 * Postinstall script — runs automatically after `bun install`
 *
 * 1. Installs LSP dependencies for bundled extensions
 * 2. Builds tree-sitter WASM parsers from source into public/tree-sitter/parsers/{lang}/parser.wasm
 *    using tree-sitter-cli and individual grammar packages
 */
import { $ } from "bun";
import { existsSync } from "node:fs";

// ─── LSP Dependencies ───────────────────────────────────────────────

const BUNDLED_EXTENSIONS_DIR = "src/extensions/bundled";

async function installBundledLspDependencies() {
  console.log("Installing bundled extension LSP dependencies...");

  const bundledDir = `${process.cwd()}/${BUNDLED_EXTENSIONS_DIR}`;

  if (!(await Bun.file(bundledDir).exists())) {
    console.log("No bundled extensions directory found, skipping.");
    return;
  }

  const directories = (await $`find ${bundledDir} -mindepth 1 -maxdepth 1 -type d`.text())
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const extDir of directories) {
    const extName = extDir.split("/").pop() || extDir;
    const lspDir = `${extDir}/lsp`;
    const packageJson = `${lspDir}/package.json`;

    if (await Bun.file(packageJson).exists()) {
      console.log(`  Installing LSP for ${extName}...`);
      try {
        await $`cd ${lspDir} && bun install`.quiet();
        console.log(`  Installed ${extName} LSP dependencies`);
      } catch (error) {
        console.error(`  Failed to install ${extName} LSP:`, error);
      }
    }
  }

  console.log("Bundled LSP installation complete.\n");
}

// ─── Tree-sitter Parsers ────────────────────────────────────────────

const PARSERS_DIR = `${process.cwd()}/public/tree-sitter/parsers`;

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
  diff: { package: "tree-sitter-diff" },
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
  markdown: {
    package: "@tree-sitter-grammars/tree-sitter-markdown",
    subdir: "tree-sitter-markdown",
  },
  objc: { package: "tree-sitter-objc" },
  ocaml: { package: "tree-sitter-ocaml", subdir: "grammars/ocaml" },
  php: { package: "tree-sitter-php", subdir: "php" },
  python: { package: "tree-sitter-python" },
  rescript: { package: "tree-sitter-rescript" },
  ruby: { package: "tree-sitter-ruby" },
  rust: { package: "tree-sitter-rust" },
  scala: { package: "tree-sitter-scala" },
  solidity: { package: "tree-sitter-solidity" },
  svelte: { package: "tree-sitter-svelte" },
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
  const packageDir = `${process.cwd()}/node_modules/${source.package}`;
  if (!existsSync(packageDir)) {
    console.warn(`  Warning: ${source.package} not found in node_modules`);
    return false;
  }
  const destDir = `${PARSERS_DIR}/${lang}`;
  await $`mkdir -p ${destDir}`.quiet();
  const outFile = `${destDir}/parser.wasm`;
  const buildDir = source.subdir ? `${packageDir}/${source.subdir}` : packageDir;
  console.log(`  Building ${lang}...`);
  try {
    await $`npx tree-sitter build --wasm -o ${outFile} ${buildDir}`.quiet();
  } catch (error) {
    console.warn(`  Warning: Failed to build ${lang} parser:`, error);
    return false;
  }
  if (!(await Bun.file(outFile).exists())) return false;
  // Copy highlights.scm if not already tracked (we have hand-edited versions)
  const highlightsDest = `${destDir}/highlights.scm`;
  if (!(await Bun.file(highlightsDest).exists())) {
    const candidates = [
      `${packageDir}/queries/highlights.scm`,
      ...(source.subdir ? [`${buildDir}/queries/highlights.scm`] : []),
    ];
    for (const candidate of candidates) {
      if (await Bun.file(candidate).exists()) {
        await Bun.write(highlightsDest, Bun.file(candidate));
        break;
      }
    }
  }
  return true;
}

async function setupTreeSitterParsers() {
  console.log("Setting up tree-sitter parsers...");

  await $`mkdir -p ${PARSERS_DIR}`.quiet();

  let built = 0;
  let skipped = 0;
  let failed = 0;

  for (const [lang, source] of Object.entries(BUNDLED_PARSERS)) {
    const destDir = `${PARSERS_DIR}/${lang}`;
    const destFile = `${destDir}/parser.wasm`;

    await $`mkdir -p ${destDir}`.quiet();

    // Skip if parser.wasm already exists
    if (await Bun.file(destFile).exists()) {
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
