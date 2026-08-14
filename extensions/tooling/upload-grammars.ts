/**
 * Upload parser WASM files to the extension CDN.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getExtensionCdnPath,
  getExtensionSourceDir,
  listExtensionFolders,
} from "./extension-workspace";

const targetRoot = process.env.EXTENSIONS_CDN_ROOT;

if (!targetRoot) {
  console.error("Missing EXTENSIONS_CDN_ROOT environment variable.");
  process.exit(1);
}

let uploaded = 0;
let skipped = 0;

for (const folder of await listExtensionFolders()) {
  const sourceDir = getExtensionSourceDir(folder);
  const wasmPath = join(sourceDir, "parser.wasm");

  if (!existsSync(wasmPath)) {
    skipped++;
    continue;
  }

  const manifest = JSON.parse(await readFile(join(sourceDir, "extension.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const cdnPath = getExtensionCdnPath(folder, manifest);
  const targetDir = join(targetRoot, cdnPath);
  await mkdir(targetDir, { recursive: true });
  await copyFile(wasmPath, join(targetDir, "parser.wasm"));
  console.log(`Uploaded ${cdnPath}/parser.wasm`);
  uploaded++;
}

console.log(`\nDone: ${uploaded} files uploaded, ${skipped} folders had no parser.wasm`);
