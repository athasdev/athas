/**
 * Install LSP dependencies for all bundled extensions
 * Runs automatically after `bun install` via postinstall hook
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const BUNDLED_EXTENSIONS_DIR = "src/extensions/bundled";

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

await installBundledLspDependencies();
