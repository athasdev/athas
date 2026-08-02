import { joinPath } from "@/utils/path-helpers";

export type NewProjectSource = "empty" | "nextjs" | "vite-react" | "clone";
export type ProjectPackageManager = "npm" | "pnpm" | "bun";

const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export function getProjectNameError(projectName: string): string | null {
  const trimmedName = projectName.trim();
  if (!trimmedName) return "Enter a project name.";
  if (trimmedName === "." || trimmedName === "..") {
    return "Project names cannot be path traversal segments.";
  }
  const hasControlCharacter = [...trimmedName].some((character) => character.charCodeAt(0) < 32);
  if (hasControlCharacter || /[<>:"/\\|?*]/.test(trimmedName)) {
    return "Project names cannot contain path separators or reserved characters.";
  }
  if (/[. ]$/.test(trimmedName)) {
    return "Project names cannot end with a period or space.";
  }

  const windowsBaseName = trimmedName.split(".")[0]?.toLowerCase();
  if (windowsBaseName && WINDOWS_RESERVED_NAMES.has(windowsBaseName)) {
    return "Choose a project name that is supported on every platform.";
  }

  return null;
}

export function inferProjectNameFromRepositoryUrl(repositoryUrl: string): string {
  const trimmedUrl = repositoryUrl.trim().replace(/[\\/]+$/, "");
  if (!trimmedUrl) return "";

  const lastSegment = trimmedUrl.split(/[/:]/).filter(Boolean).pop() ?? "";
  const withoutGitSuffix = lastSegment.replace(/\.git$/i, "");

  try {
    return decodeURIComponent(withoutGitSuffix);
  } catch {
    return withoutGitSuffix;
  }
}

export function getNewProjectPath(locationPath: string, projectName: string): string {
  return joinPath(locationPath.trim(), projectName.trim());
}

export function getStarterCommand(
  source: Exclude<NewProjectSource, "empty" | "clone">,
  packageManager: ProjectPackageManager,
): string {
  if (source === "nextjs") {
    const runner = {
      npm: "npx --yes",
      pnpm: "pnpm dlx",
      bun: "bunx",
    }[packageManager];
    const packageManagerFlag = {
      npm: "--use-npm",
      pnpm: "--use-pnpm",
      bun: "--use-bun",
    }[packageManager];

    return `${runner} create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" ${packageManagerFlag}`;
  }

  const createCommand = {
    npm: "npm create vite@latest . -- --template react-ts",
    pnpm: "pnpm create vite@latest . --template react-ts",
    bun: "bun create vite@latest . --template react-ts",
  }[packageManager];
  const installCommand = {
    npm: "npm install",
    pnpm: "pnpm install",
    bun: "bun install",
  }[packageManager];

  return `${createCommand} && ${installCommand}`;
}
