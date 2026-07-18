import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const sampleRoots = ["src", "crates", "src-tauri/src"];
const sampleLimit = Number.parseInt(process.argv[2] ?? "120", 10);
const rounds = Number.parseInt(process.argv[3] ?? "5", 10);

const textExtensions = new Set([
  ".c",
  ".cfg",
  ".conf",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zig",
]);

const textFileNames = new Set(["cargo.lock", "package.json", "bun.lock", "tsconfig.json"]);

function extensionOf(path: string): string {
  const normalized = path.toLowerCase();
  const slashIndex = normalized.lastIndexOf("/");
  const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex) : "";
}

function fileNameOf(path: string): string {
  const normalized = path.toLowerCase();
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function isKnownTextPath(path: string): boolean {
  return textFileNames.has(fileNameOf(path)) || textExtensions.has(extensionOf(path));
}

async function collectFiles(dir: string, files: string[]): Promise<void> {
  if (files.length >= sampleLimit) return;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= sampleLimit) return;
    if (entry.name === "target" || entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(path, files);
    } else if (entry.isFile() && isKnownTextPath(path)) {
      files.push(path);
    }
  }
}

async function measure<T>(task: () => Promise<T>): Promise<{ duration: number; value: T }> {
  const startedAt = performance.now();
  const value = await task();
  return { duration: performance.now() - startedAt, value };
}

async function previousOpenPreflight(path: string): Promise<number> {
  const result = await measure(async () => {
    await lstat(path);
    return readFile(path);
  });
  return result.duration;
}

async function optimizedOpenPreflight(path: string): Promise<number> {
  const result = await measure(async () => {
    if (!isKnownTextPath(path)) {
      await lstat(path);
    }
    return readFile(path);
  });
  return result.duration;
}

function percentile(values: number[], percent: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percent));
  return sorted[index] ?? 0;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function format(value: number): string {
  return `${value.toFixed(2)}ms`;
}

async function main() {
  const files: string[] = [];
  for (const sampleRoot of sampleRoots) {
    await collectFiles(join(root, sampleRoot), files);
  }

  const previous: number[] = [];
  const optimized: number[] = [];

  for (let round = 0; round < rounds; round++) {
    for (const file of files) {
      previous.push(await previousOpenPreflight(file));
      optimized.push(await optimizedOpenPreflight(file));
    }
  }

  const previousAverage = average(previous);
  const optimizedAverage = average(optimized);
  const savedAverage = previousAverage - optimizedAverage;

  console.log(`files=${files.length} rounds=${rounds}`);
  console.log(
    `previous avg=${format(previousAverage)} p50=${format(percentile(previous, 0.5))} p95=${format(
      percentile(previous, 0.95),
    )}`,
  );
  console.log(
    `optimized avg=${format(optimizedAverage)} p50=${format(
      percentile(optimized, 0.5),
    )} p95=${format(percentile(optimized, 0.95))}`,
  );
  console.log(`saved avg=${format(savedAverage)} per open`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
