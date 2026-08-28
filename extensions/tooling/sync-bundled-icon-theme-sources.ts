import { cp, readdir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { ATHAS_ROOT } from "./extension-workspace";

const sourceDirectory = join(ATHAS_ROOT, "extensions/official/icons-symbols");
const bundledDirectory = join(ATHAS_ROOT, "src/extensions/bundled/icon-themes/symbols");
const checkOnly = process.argv.includes("--check");

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDirectory: string) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        files.push(relative(directory, path));
      }
    }
  }

  await walk(directory);
  return files.sort();
}

async function directoriesMatch() {
  const [sourceFiles, bundledFiles] = await Promise.all([
    listFiles(sourceDirectory),
    listFiles(bundledDirectory),
  ]);
  if (JSON.stringify(sourceFiles) !== JSON.stringify(bundledFiles)) return false;

  const comparisons = await Promise.all(
    sourceFiles.map(async (file) => {
      const [source, bundled] = await Promise.all([
        readFile(join(sourceDirectory, file)),
        readFile(join(bundledDirectory, file)),
      ]);
      return source.equals(bundled);
    }),
  );
  return comparisons.every(Boolean);
}

if (checkOnly) {
  if (!(await directoriesMatch())) {
    console.error(
      "Bundled Symbols icon-theme assets are out of date. Run `bun run extensions:sync-bundled-icon-themes`.",
    );
    process.exit(1);
  }
  console.log("Bundled Symbols icon-theme assets match the official source.");
  process.exit(0);
}

await rm(bundledDirectory, { recursive: true, force: true });
await cp(sourceDirectory, bundledDirectory, { recursive: true });
console.log("Synchronized bundled Symbols icon-theme assets from the official source.");
