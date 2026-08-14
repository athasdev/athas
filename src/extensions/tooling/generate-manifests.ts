/**
 * Generate the extension CDN manifest from source extension folders.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GENERATED_CDN_DIR,
  getContributionArray,
  getExtensionCdnPath,
  getReservedBuiltInThemeContribution,
  listExtensionFolders,
  readDeployableExtensionManifest,
  readExtensionArtifacts,
} from "./extension-workspace";

const folders = await listExtensionFolders();
const artifacts = await readExtensionArtifacts();
const manifests: Record<string, unknown> = {};

for (const folder of folders) {
  const manifest = await readDeployableExtensionManifest(folder, artifacts);
  const reservedTheme = getContributionArray(manifest, "themes").find(
    getReservedBuiltInThemeContribution,
  );
  if (reservedTheme) {
    throw new Error(
      `Extension ${String(manifest.id)} contributes reserved built-in Athas theme "${String(reservedTheme.name || reservedTheme.id)}"`,
    );
  }
  manifests[getExtensionCdnPath(folder, manifest)] = manifest;
}

await mkdir(GENERATED_CDN_DIR, { recursive: true });
await writeFile(
  join(GENERATED_CDN_DIR, "manifests.json"),
  JSON.stringify(manifests, null, 2) + "\n",
);

console.log(`Generated manifests.json with ${Object.keys(manifests).length} extensions`);
