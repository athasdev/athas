import { createGzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type ExtensionManifestRecord = Record<string, unknown>;

export const FEATURE_ROOT = resolve(import.meta.dirname, "..");
export const ATHAS_ROOT = resolve(FEATURE_ROOT, "../../..");
export const EXTENSIONS_ROOT = join(ATHAS_ROOT, "extensions");
export const GENERATED_CDN_DIR = join(EXTENSIONS_ROOT, "generated", "cdn");
export const CATALOG_DIR = join(FEATURE_ROOT, "catalog");

const CONTRIBUTION_ALIASES: Record<string, string[]> = {
  databases: ["databases", "databaseProviders"],
  databaseProviders: ["databases", "databaseProviders"],
  icons: ["icons", "iconThemes"],
  iconThemes: ["icons", "iconThemes"],
};

function contributionKeys(key: string): string[] {
  return CONTRIBUTION_ALIASES[key] ?? [key];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getContributionArray(
  manifest: ExtensionManifestRecord,
  key: string,
): Array<Record<string, unknown>> {
  const contributes = objectRecord(manifest.contributes);
  const items: Array<Record<string, unknown>> = [];

  for (const contributionKey of contributionKeys(key)) {
    const topLevel = manifest[contributionKey];
    const contributed = contributes[contributionKey];

    if (Array.isArray(topLevel)) {
      items.push(...(topLevel as Array<Record<string, unknown>>));
    }

    if (Array.isArray(contributed)) {
      items.push(...(contributed as Array<Record<string, unknown>>));
    }
  }

  return items;
}

export async function listExtensionFolders(): Promise<string[]> {
  const folders: string[] = [];

  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });

    if (entries.some((entry) => entry.isFile() && entry.name === "extension.json")) {
      folders.push(relative(EXTENSIONS_ROOT, directory));
      return;
    }

    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name !== "generated" &&
            entry.name !== "node_modules" &&
            entry.name !== "packages",
        )
        .map((entry) => walk(join(directory, entry.name))),
    );
  }

  await walk(EXTENSIONS_ROOT);
  return folders.sort((a, b) => a.localeCompare(b));
}

export function getExtensionSourceDir(folder: string): string {
  return join(EXTENSIONS_ROOT, folder);
}

export function getExtensionCdnPath(folder: string, manifest: ExtensionManifestRecord): string {
  const slug = basename(folder);
  const databases = getContributionArray(manifest, "databases");
  const agents = getContributionArray(manifest, "agents");
  const themes = getContributionArray(manifest, "themes");
  const icons = getContributionArray(manifest, "icons");

  if (databases.length > 0 && typeof databases[0].id === "string") {
    return `database/${databases[0].id}`;
  }

  if (agents.length > 0 && typeof agents[0].id === "string") {
    return `agents/${agents[0].id}`;
  }

  if (icons.length > 0) {
    const iconSlug = slug.startsWith("icons-") ? slug.slice("icons-".length) : String(icons[0].id);
    return `icon-theme/${iconSlug}`;
  }

  if (themes.length > 0) {
    const themeSlug = slug.startsWith("theme-")
      ? slug.slice("theme-".length)
      : String(themes[0].id);
    return `theme/${themeSlug}`;
  }

  return slug;
}

export function getGeneratedCdnPath(relativePath = ""): string {
  return join(GENERATED_CDN_DIR, relativePath);
}

function stringifyManifest(manifest: ExtensionManifestRecord): string {
  return JSON.stringify(manifest, null, 2).replace(
    /\[\n((?: {4}"[^"\n]*",?\n)+) {2}\]/g,
    (match, contents: string) => {
      const values = contents
        .trim()
        .split("\n")
        .map((line) => line.trim().replace(/,$/, ""));

      return values.every((value) => /^"[^"\n]*"$/.test(value)) ? `[${values.join(", ")}]` : match;
    },
  );
}

export async function writeExtensionManifest(
  manifestPath: string,
  manifest: ExtensionManifestRecord,
) {
  await writeFile(manifestPath, `${stringifyManifest(manifest)}\n`);
}

async function listPackageFiles(root: string) {
  const files: string[] = [];

  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;

      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(relative(root, absolutePath));
      }
    }
  }

  await walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function writeOctalField(header: Buffer, offset: number, length: number, value: number) {
  const octal = value.toString(8).padStart(length - 1, "0");
  header.write(octal, offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function writeTarHeader(path: string, size: number, mode: number) {
  const header = Buffer.alloc(512, 0);
  const normalizedPath = path.replace(/\\/g, "/");

  if (Buffer.byteLength(normalizedPath) > 100) {
    throw new Error(`Packaged extension path is too long for portable tar: ${normalizedPath}`);
  }

  header.write(normalizedPath, 0, 100, "utf8");
  writeOctalField(header, 100, 8, mode & 0o777);
  writeOctalField(header, 108, 8, 0);
  writeOctalField(header, 116, 8, 0);
  writeOctalField(header, 124, 12, size);
  writeOctalField(header, 136, 12, 1577836800);
  header.fill(" ", 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

export async function writeStableTarGz(root: string, packagePath: string) {
  const chunks: Buffer[] = [];

  for (const file of await listPackageFiles(root)) {
    const absolutePath = join(root, file);
    const fileStats = await stat(absolutePath);
    const contents = await readFile(absolutePath);
    chunks.push(writeTarHeader(file, contents.length, fileStats.mode));
    chunks.push(contents);

    const padding = (512 - (contents.length % 512)) % 512;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding, 0));
    }
  }

  chunks.push(Buffer.alloc(1024, 0));
  const output = createWriteStream(packagePath);
  const gzip = createGzip({ level: 9 });
  await pipeline(Readable.from(chunks), gzip, output);
}
