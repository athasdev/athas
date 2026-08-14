#!/usr/bin/env bun

import { $ } from "bun";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createDeployableExtensionManifest,
  getExtensionCdnPath,
  getExtensionSourceDir,
  getGeneratedCdnPath,
  listExtensionFolders,
  readExtensionArtifacts,
  writeExtensionManifest,
} from "./extension-workspace";

await mkdir(getGeneratedCdnPath(), { recursive: true });
const artifacts = await readExtensionArtifacts();

for (const folder of await listExtensionFolders()) {
  const sourceDir = getExtensionSourceDir(folder);
  const manifest = JSON.parse(await readFile(join(sourceDir, "extension.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const cdnPath = getExtensionCdnPath(folder, manifest);
  const targetDir = getGeneratedCdnPath(cdnPath);

  await mkdir(targetDir, { recursive: true });
  await $`rsync -az --delete \
    --exclude='.DS_Store' \
    --exclude='node_modules' \
    --exclude='build/node_modules' \
    --exclude='*.tar.gz' \
    ${sourceDir}/ ${targetDir}/`;
  await writeExtensionManifest(
    join(targetDir, "extension.json"),
    createDeployableExtensionManifest(manifest, artifacts),
  );
}

console.log("Staged extension CDN assets.");
