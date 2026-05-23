/**
 * Generate the extension CDN manifest from source extension folders.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GENERATED_CDN_DIR,
  getExtensionCdnPath,
  getExtensionSourceDir,
  listExtensionFolders,
} from "./extension-workspace";

const folders = await listExtensionFolders();
const manifests: Record<string, unknown> = {};

for (const folder of folders) {
  const manifestPath = join(getExtensionSourceDir(folder), "extension.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifests[getExtensionCdnPath(folder, manifest)] = manifest;
}

await mkdir(GENERATED_CDN_DIR, { recursive: true });
await writeFile(
  join(GENERATED_CDN_DIR, "manifests.json"),
  JSON.stringify(manifests, null, 2) + "\n",
);

console.log(`Generated manifests.json with ${Object.keys(manifests).length} extensions`);
