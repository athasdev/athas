import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

export type ExtensionManifestRecord = Record<string, unknown>;

export const ATHAS_ROOT = resolve(import.meta.dirname, "../..");
export const EXTENSIONS_ROOT = join(ATHAS_ROOT, "extensions");
export const GENERATED_CDN_DIR = join(EXTENSIONS_ROOT, "generated", "cdn");
export const EXTENSION_ARTIFACTS_PATH = join(EXTENSIONS_ROOT, "artifacts.json");
export const CATALOG_DIR = join(import.meta.dirname, "catalog");
const OFFICIAL_EXTENSIONS_DIR = join(EXTENSIONS_ROOT, "official");
const COMMUNITY_EXTENSIONS_DIR = join(EXTENSIONS_ROOT, "community");
const BUILD_ONLY_PACKAGE_ENTRIES = new Set([
  "build",
  "build.sh",
  "node_modules",
  "package-lock.json",
  "pnpm-lock.yaml",
  "tooling.json",
  "yarn.lock",
]);

export interface ExtensionArtifactsFile {
  version: 1;
  installations: Record<string, ExtensionManifestRecord>;
}

export interface ExtensionPackageLayoutIssue {
  folder: string;
  message: string;
}

const CONTRIBUTION_ALIASES: Record<string, string[]> = {
  databases: ["databases", "databaseProviders"],
  databaseProviders: ["databases", "databaseProviders"],
  icons: ["icons", "iconThemes"],
  iconThemes: ["icons", "iconThemes"],
};

const RESERVED_BUILT_IN_THEME_IDS = new Set(["athas-light", "athas-dark"]);
const RESERVED_BUILT_IN_THEME_NAMES = new Set(["athas light", "athas dark"]);

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

export function getReservedBuiltInThemeContribution(theme: Record<string, unknown>) {
  const id = typeof theme.id === "string" ? theme.id.trim().toLowerCase() : "";
  const name = typeof theme.name === "string" ? theme.name.trim().toLowerCase() : "";

  if (RESERVED_BUILT_IN_THEME_IDS.has(id) || RESERVED_BUILT_IN_THEME_NAMES.has(name)) {
    return { id, name };
  }

  return null;
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
        .filter((entry) => entry.isDirectory())
        .map((entry) => walk(join(directory, entry.name))),
    );
  }

  await Promise.all([walk(OFFICIAL_EXTENSIONS_DIR), walk(COMMUNITY_EXTENSIONS_DIR)]);
  return folders.sort((a, b) => a.localeCompare(b));
}

function isKebabCase(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

async function inspectPackageDirectories(
  root: string,
  depth: number,
): Promise<ExtensionPackageLayoutIssue[]> {
  const issues: ExtensionPackageLayoutIssue[] = [];

  async function walk(directory: string, remainingDepth: number) {
    const entries = await readdir(directory, { withFileTypes: true });
    const relativeFolder = relative(EXTENSIONS_ROOT, directory);

    if (remainingDepth === 0) {
      if (!entries.some((entry) => entry.isFile() && entry.name === "extension.json")) {
        issues.push({
          folder: relativeFolder,
          message: "Package folder is missing extension.json",
        });
      }
      if (!isKebabCase(basename(directory))) {
        issues.push({ folder: relativeFolder, message: "Package folder must use kebab-case" });
      }
      for (const entry of entries) {
        if (BUILD_ONLY_PACKAGE_ENTRIES.has(entry.name)) {
          issues.push({
            folder: relativeFolder,
            message: `Build-only entry '${entry.name}' must live in extensions/tooling`,
          });
        }
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (remainingDepth > 1 && !isKebabCase(entry.name)) {
        issues.push({
          folder: relative(EXTENSIONS_ROOT, join(directory, entry.name)),
          message: "Publisher folder must use kebab-case",
        });
      }
      await walk(join(directory, entry.name), remainingDepth - 1);
    }
  }

  await walk(root, depth);
  return issues;
}

export async function inspectExtensionPackageLayout(): Promise<ExtensionPackageLayoutIssue[]> {
  const issues = await Promise.all([
    inspectPackageDirectories(OFFICIAL_EXTENSIONS_DIR, 1),
    inspectPackageDirectories(COMMUNITY_EXTENSIONS_DIR, 2),
  ]);
  return issues.flat();
}

export function getExtensionSourceDir(folder: string): string {
  return join(EXTENSIONS_ROOT, folder);
}

export async function readExtensionSourceManifest(
  folder: string,
): Promise<ExtensionManifestRecord> {
  return JSON.parse(
    await readFile(join(getExtensionSourceDir(folder), "extension.json"), "utf8"),
  ) as ExtensionManifestRecord;
}

export async function readExtensionArtifacts(): Promise<ExtensionArtifactsFile> {
  try {
    const value = JSON.parse(
      await readFile(EXTENSION_ARTIFACTS_PATH, "utf8"),
    ) as Partial<ExtensionArtifactsFile>;
    return {
      version: 1,
      installations: value.installations ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, installations: {} };
    }
    throw error;
  }
}

export async function writeExtensionArtifacts(artifacts: ExtensionArtifactsFile): Promise<void> {
  const installations = Object.fromEntries(
    Object.entries(artifacts.installations).sort(([left], [right]) => left.localeCompare(right)),
  );
  await writeFile(
    EXTENSION_ARTIFACTS_PATH,
    `${JSON.stringify({ version: 1, installations }, null, 2)}\n`,
  );
}

export function createDeployableExtensionManifest(
  manifest: ExtensionManifestRecord,
  artifacts: ExtensionArtifactsFile,
): ExtensionManifestRecord {
  const installation =
    typeof manifest.id === "string" ? artifacts.installations[manifest.id] : null;
  if (!installation) return { ...manifest };
  return { ...manifest, installation };
}

export async function readDeployableExtensionManifest(
  folder: string,
  artifacts?: ExtensionArtifactsFile,
): Promise<ExtensionManifestRecord> {
  return createDeployableExtensionManifest(
    await readExtensionSourceManifest(folder),
    artifacts ?? (await readExtensionArtifacts()),
  );
}

export function getExtensionCdnPath(folder: string, manifest: ExtensionManifestRecord): string {
  const slug = basename(folder);
  const databases = getContributionArray(manifest, "databases");
  const agents = getContributionArray(manifest, "agents");
  const themes = getContributionArray(manifest, "themes");
  const icons = getContributionArray(manifest, "icons");
  const integrations = getContributionArray(manifest, "integrations");
  const skills = getContributionArray(manifest, "skills");

  if (integrations.length > 0 && typeof integrations[0].id === "string") {
    return `integration/${integrations[0].id}`;
  }

  if (skills.length > 0) {
    return `skills/${slug.replace(/^skill-/, "")}`;
  }

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
    /\[\n((?:\s+"[^"\n]*",?\n)+)\s+\]/g,
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

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function gzipStored(contents: Buffer): Buffer {
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0xff]);
  const blocks: Buffer[] = [];

  for (let offset = 0; offset < contents.length; offset += 0xffff) {
    const length = Math.min(0xffff, contents.length - offset);
    const blockHeader = Buffer.alloc(5);
    blockHeader[0] = offset + length >= contents.length ? 1 : 0;
    blockHeader.writeUInt16LE(length, 1);
    blockHeader.writeUInt16LE(~length & 0xffff, 3);
    blocks.push(blockHeader, contents.subarray(offset, offset + length));
  }

  let crc = 0xffffffff;
  for (const byte of contents) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 0);
  trailer.writeUInt32LE(contents.length >>> 0, 4);

  return Buffer.concat([header, ...blocks, trailer]);
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
  await writeFile(packagePath, gzipStored(Buffer.concat(chunks)));
}
