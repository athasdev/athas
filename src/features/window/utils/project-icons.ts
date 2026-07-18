import { convertFileSrc } from "@tauri-apps/api/core";
import { readDir } from "@tauri-apps/plugin-fs";

export interface ProjectIconFile {
  name: string;
  path: string;
  src: string;
  score: number;
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".output",
  ".next",
  ".nuxt",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

function getPathSegments(path: string) {
  return path.toLowerCase().split(/[\\/]/).filter(Boolean);
}

function isLikelyIconFile(name: string) {
  if (!/\.(ico|png|svg)$/i.test(name)) return false;
  return /app[-_ ]?icon|apple[-_ ]touch[-_ ]icon|favicon|icon|logo/i.test(name);
}

function scoreIconPath(path: string, projectPath: string) {
  const relativePath = path.startsWith(projectPath)
    ? path.slice(projectPath.length).replace(/^[/\\]/, "")
    : path;
  const normalized = relativePath.toLowerCase().replace(/\\/g, "/");
  const name = normalized.split("/").pop() ?? normalized;
  const segments = normalized.split("/").filter(Boolean);

  let score = 0;

  if (normalized.includes("src-tauri/icons/")) score += 120;
  if (normalized.includes("packages/desktop/resources/")) score += 110;
  if (normalized.includes("desktop/resources/")) score += 100;
  if (segments.includes("public")) score += 90;
  if (segments.length <= 2) score += 60;

  if (/^app[-_ ]?icon\.(png|svg|ico)$/i.test(name)) score += 80;
  if (/^icon\.(png|svg|ico)$/i.test(name)) score += 70;
  if (/^favicon\.ico$/i.test(name)) score += 65;
  if (/^logo\.(png|svg|ico)$/i.test(name)) score += 55;
  if (/^icon[-_ ]?512\.(png|svg|ico)$/i.test(name)) score += 45;
  if (/^icon[-_ ]?192\.(png|svg|ico)$/i.test(name)) score += 40;
  if (/^apple[-_ ]touch[-_ ]icon\.(png|svg|ico)$/i.test(name)) score += 35;
  if (/mask/i.test(name)) score -= 25;
  if (segments.includes("docs") || segments.includes("test") || segments.includes("tests")) {
    score -= 60;
  }

  return score - segments.length;
}

export async function scanProjectIconFiles(projectPath: string): Promise<ProjectIconFile[]> {
  const results: ProjectIconFile[] = [];
  const separator = projectPath.includes("\\") ? "\\" : "/";

  async function scanDirectory(dirPath: string, depth: number) {
    if (depth > 4) return;

    try {
      const entries = await readDir(dirPath);
      const childDirectories: string[] = [];

      for (const entry of entries) {
        if (!entry.name) continue;

        const entryPath = `${dirPath}${separator}${entry.name}`;

        if (!entry.isDirectory && isLikelyIconFile(entry.name)) {
          results.push({
            name: entry.name,
            path: entryPath,
            src: convertFileSrc(entryPath),
            score: scoreIconPath(entryPath, projectPath),
          });
        }

        if (entry.isDirectory && !entry.name.startsWith(".")) {
          if (IGNORED_DIRECTORIES.has(entry.name)) continue;
          childDirectories.push(entryPath);
        }
      }

      await Promise.all(childDirectories.map((childPath) => scanDirectory(childPath, depth + 1)));
    } catch {
      // Skip directories we can't read.
    }
  }

  await scanDirectory(projectPath, 0);

  return results.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return getPathSegments(left.path).length - getPathSegments(right.path).length;
  });
}

export async function findBestProjectIcon(projectPath: string) {
  const icons = await scanProjectIconFiles(projectPath);
  return icons[0] ?? null;
}
