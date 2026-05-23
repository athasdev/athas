#!/usr/bin/env bun

import { $ } from "bun";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  ATHAS_ROOT,
  getContributionArray,
  getExtensionCdnPath,
  getExtensionSourceDir,
  getGeneratedCdnPath,
  listExtensionFolders,
  writeExtensionManifest,
} from "./extension-workspace";

const cdnBaseUrl = process.env.EXTENSIONS_CDN_BASE_URL || "https://athas.dev/extensions";

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function currentPlatformArch() {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

async function sha256(path: string) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function hasCompletePackageInfo(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.downloadUrl === "string" &&
    entry.downloadUrl.length > 0 &&
    typeof entry.size === "number" &&
    entry.size > 0 &&
    typeof entry.checksum === "string" &&
    entry.checksum.length > 0
  );
}

async function createPackage(params: {
  extensionDir: string;
  manifest: Record<string, unknown>;
  sidecarPath: string;
  binaryPath: string;
  packagePath: string;
}) {
  const tempDir = await mkdtemp(join(tmpdir(), "athas-db-extension-"));

  try {
    await $`rsync -az --exclude='.DS_Store' ${params.extensionDir}/ ${tempDir}/`;

    const packagedManifest = { ...params.manifest };
    delete packagedManifest.installation;
    await writeFile(
      join(tempDir, "extension.json"),
      `${JSON.stringify(packagedManifest, null, 2)}\n`,
    );

    const targetBinary = join(tempDir, params.sidecarPath);
    await mkdir(dirname(targetBinary), { recursive: true });
    await cp(params.binaryPath, targetBinary);
    await chmod(targetBinary, 0o755);

    await mkdir(dirname(params.packagePath), { recursive: true });
    await $`find ${tempDir} -exec touch -t 202001010000 {} +`;
    await $`find . -type f -print | LC_ALL=C sort | tar --no-xattrs --owner=0 --group=0 --numeric-owner -cf - -C ${tempDir} -T - | gzip -n > ${params.packagePath}`.cwd(
      tempDir,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function findDatabaseExtensionFolders(providerFilter?: string) {
  const databaseFolders: Array<{
    folder: string;
    manifest: Record<string, unknown>;
    provider: Record<string, unknown>;
  }> = [];

  for (const folder of await listExtensionFolders()) {
    const manifestPath = join(getExtensionSourceDir(folder), "extension.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const provider = getContributionArray(manifest, "databases")[0];
    if (!provider) continue;
    if (providerFilter && provider.id !== providerFilter) continue;
    databaseFolders.push({ folder, manifest, provider });
  }

  if (providerFilter && databaseFolders.length === 0) {
    throw new Error(`Unknown database provider: ${providerFilter}`);
  }

  return databaseFolders;
}

const platformArch = argValue("--platform") || process.env.PLATFORM_ARCH || currentPlatformArch();
const shouldBuild = process.argv.includes("--build") || process.env.BUILD_DATABASE_SIDECARS === "1";
const binDir = resolve(
  argValue("--bin-dir") || process.env.ATHAS_DATABASE_SIDECAR_BIN_DIR || "target/release",
);
const providerFilter = argValue("--provider");
let packagedCount = 0;

async function buildSidecar(providerId: string, binaryName: string) {
  await $`cargo build -p athas-database --release --no-default-features --features ${providerId} --bin ${binaryName}`.cwd(
    ATHAS_ROOT,
  );
}

for (const { folder, manifest, provider } of await findDatabaseExtensionFolders(providerFilter)) {
  const extensionDir = getExtensionSourceDir(folder);
  const manifestPath = join(extensionDir, "extension.json");
  const sidecar = provider.sidecar as Record<string, string> | undefined;
  const sidecarPath = sidecar?.[platformArch];
  const providerId = String(provider.id);

  if (!sidecarPath) {
    throw new Error(`Database extension ${providerId} has no sidecar for ${platformArch}`);
  }

  const binaryPath = join(binDir, basename(sidecarPath));
  if (shouldBuild) {
    await buildSidecar(providerId, basename(sidecarPath));
  }

  if (
    !(await stat(binaryPath)
      .then((value) => value.isFile())
      .catch(() => false))
  ) {
    throw new Error(
      `Missing database sidecar binary for ${providerId}: ${binaryPath}. Run this script with --build, or build it from the Athas repo with: cargo build -p athas-database --release --no-default-features --features ${providerId} --bin ${basename(sidecarPath)}`,
    );
  }

  const cdnPath = getExtensionCdnPath(folder, manifest);
  const packagePath = getGeneratedCdnPath(join(cdnPath, `${platformArch}.tar.gz`));
  await createPackage({ extensionDir, manifest, sidecarPath, binaryPath, packagePath });

  const packageStats = await stat(packagePath);
  const packageInfo = {
    downloadUrl: `${cdnBaseUrl}/${cdnPath}/${platformArch}.tar.gz`,
    size: packageStats.size,
    checksum: await sha256(packagePath),
  };

  const installation = (manifest.installation ?? {}) as Record<string, unknown>;
  const platformPackages = Object.fromEntries(
    Object.entries((installation.platformArch ?? {}) as Record<string, unknown>).filter(
      ([, value]) => hasCompletePackageInfo(value),
    ),
  );
  platformPackages[platformArch] = packageInfo;
  installation.platformArch = platformPackages;
  installation.downloadUrl = packageInfo.downloadUrl;
  installation.size = packageInfo.size;
  installation.checksum = packageInfo.checksum;
  manifest.installation = installation;

  await writeExtensionManifest(manifestPath, manifest);
  packagedCount += 1;
}

console.log(`Packaged ${packagedCount} database sidecar extension(s) for ${platformArch}.`);
