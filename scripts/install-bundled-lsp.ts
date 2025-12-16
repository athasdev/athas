/**
 * Install LSP dependencies for all bundled extensions
 * and copy tree-sitter WASM files to public directory
 * Runs automatically after `bun install` via postinstall hook
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const BUNDLED_EXTENSIONS_DIR = "src/extensions/bundled";
const TREE_SITTER_WASMS_DIR = "node_modules/tree-sitter-wasms/out";
const PUBLIC_PARSERS_DIR = "public/tree-sitter/parsers";
const PUBLIC_QUERIES_DIR = "public/tree-sitter/queries";

async function installBundledLspDependencies() {
  console.log("Installing bundled extension LSP dependencies...");

  const bundledDir = join(process.cwd(), BUNDLED_EXTENSIONS_DIR);

  if (!existsSync(bundledDir)) {
    console.log("No bundled extensions directory found, skipping.");
    return;
  }

  const extensions = await readdir(bundledDir, { withFileTypes: true });

  for (const ext of extensions) {
    if (!ext.isDirectory()) continue;

    const lspDir = join(bundledDir, ext.name, "lsp");
    const packageJson = join(lspDir, "package.json");

    if (existsSync(packageJson)) {
      console.log(`Installing LSP for ${ext.name}...`);
      try {
        await $`cd ${lspDir} && bun install`.quiet();
        console.log(`  Installed ${ext.name} LSP dependencies`);
      } catch (error) {
        console.error(`  Failed to install ${ext.name} LSP:`, error);
      }
    }
  }

  console.log("Bundled LSP installation complete.");
}

/**
 * Copy tree-sitter WASM files from node_modules to public directory
 * Only copies parsers that are actually used by bundled extensions
 */
async function copyTreeSitterWasms() {
  console.log("Copying tree-sitter WASM files...");

  const wasmsDir = join(process.cwd(), TREE_SITTER_WASMS_DIR);
  const publicDir = join(process.cwd(), PUBLIC_PARSERS_DIR);

  if (!existsSync(wasmsDir)) {
    console.log("  tree-sitter-wasms not installed, skipping.");
    return;
  }

  // Ensure public directory exists
  await mkdir(publicDir, { recursive: true });

  // List of parsers to copy (used by bundled extensions)
  // Note: Rust uses CDN (see src/extensions/languages/parser-cdn.ts)
  const parsersToInstall = ["tree-sitter-tsx.wasm"];

  for (const parser of parsersToInstall) {
    const src = join(wasmsDir, parser);
    const dest = join(publicDir, parser);

    if (existsSync(src)) {
      try {
        await copyFile(src, dest);
        console.log(`  Copied ${parser}`);
      } catch (error) {
        console.error(`  Failed to copy ${parser}:`, error);
      }
    } else {
      console.warn(`  ${parser} not found in tree-sitter-wasms`);
    }
  }

  console.log("Tree-sitter WASM copy complete.");
}

/**
 * Copy highlight queries from bundled extensions to public directory
 */
async function copyHighlightQueries() {
  console.log("Copying highlight queries...");

  const bundledDir = join(process.cwd(), BUNDLED_EXTENSIONS_DIR);
  const publicQueriesDir = join(process.cwd(), PUBLIC_QUERIES_DIR);

  // Map of bundled extension to query folder name
  // Note: Rust uses CDN (see src/extensions/languages/parser-cdn.ts)
  const extensionQueryMap: Record<string, string> = {
    typescript: "tsx", // TypeScript extension provides tsx queries
  };

  for (const [extName, queryFolder] of Object.entries(extensionQueryMap)) {
    const srcQuery = join(bundledDir, extName, "queries", "highlights.scm");
    const destDir = join(publicQueriesDir, queryFolder);
    const destQuery = join(destDir, "highlights.scm");

    if (existsSync(srcQuery)) {
      try {
        await mkdir(destDir, { recursive: true });
        await copyFile(srcQuery, destQuery);
        console.log(`  Copied ${extName} queries to ${queryFolder}/`);
      } catch (error) {
        console.error(`  Failed to copy ${extName} queries:`, error);
      }
    } else {
      console.warn(`  No queries found for ${extName}`);
    }
  }

  console.log("Highlight queries copy complete.");
}

await installBundledLspDependencies();
await copyTreeSitterWasms();
await copyHighlightQueries();
