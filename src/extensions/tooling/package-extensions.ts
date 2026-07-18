#!/usr/bin/env bun

import { $ } from "bun";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SERVICE_DEFAULTS } from "@/config/service-defaults";
import {
  getContributionArray,
  getExtensionCdnPath,
  getExtensionSourceDir,
  getGeneratedCdnPath,
  listExtensionFolders,
  writeExtensionManifest,
  writeStableTarGz,
} from "./extension-workspace";

const cdnBaseUrl = process.env.EXTENSIONS_CDN_BASE_URL || SERVICE_DEFAULTS.extensionsCdnBaseUrl;

function shouldPackage(manifest: Record<string, unknown>) {
  const hasNativeSidecar = getContributionArray(manifest, "databases").length > 0;
  const isLanguage = getContributionArray(manifest, "languages").length > 0;
  const isPureAssetExtension =
    getContributionArray(manifest, "themes").length > 0 ||
    getContributionArray(manifest, "icons").length > 0;

  return isPureAssetExtension && !hasNativeSidecar && !isLanguage;
}

async function sha256(path: string) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function createStablePackage(
  extensionDir: string,
  manifest: Record<string, unknown>,
  packagePath: string,
) {
  const tempDir = await mkdtemp(join(tmpdir(), "athas-extension-"));

  try {
    await $`rsync -az --exclude='.DS_Store' ${extensionDir}/ ${tempDir}/`;

    const packagedManifest = { ...manifest };
    delete packagedManifest.installation;
    await writeFile(
      join(tempDir, "extension.json"),
      `${JSON.stringify(packagedManifest, null, 2)}\n`,
    );

    await writeStableTarGz(tempDir, packagePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const folders = await listExtensionFolders();
let packagedCount = 0;

for (const folder of folders) {
  const extensionDir = getExtensionSourceDir(folder);
  const manifestPath = join(extensionDir, "extension.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;

  if (!shouldPackage(manifest)) {
    continue;
  }

  const extensionId = String(manifest.id);
  const cdnPath = getExtensionCdnPath(folder, manifest);
  const packagePath = getGeneratedCdnPath(join("packages", cdnPath, `${extensionId}.tar.gz`));
  await mkdir(dirname(packagePath), { recursive: true });
  await createStablePackage(extensionDir, manifest, packagePath);

  const packageStats = await stat(packagePath);
  manifest.installation = {
    downloadUrl: `${cdnBaseUrl}/packages/${cdnPath}/${extensionId}.tar.gz`,
    size: packageStats.size,
    checksum: await sha256(packagePath),
  };

  await writeExtensionManifest(manifestPath, manifest);
  packagedCount += 1;
}

console.log(`Packaged ${packagedCount} extension(s).`);
