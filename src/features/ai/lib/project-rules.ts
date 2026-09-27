import { estimateTokens, truncateTextToTokens } from "@/features/ai/lib/context-budget";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import type {
  LoadedProjectRules,
  ProjectRule,
  ProjectRuleReader,
  ProjectRuleSource,
} from "@/features/ai/types/project-rules.types";
import { getRelativePath, joinPath, normalizePath, pathStartsWithRoot } from "@/utils/path-helpers";

/** The most tokens all rules together may add to the system prompt. */
export const PROJECT_RULES_MAX_TOKENS = 12_000;
/** The most tokens one rule file may add before it is truncated. */
export const PROJECT_RULE_MAX_TOKENS = 6_000;
/** Directories above the attached files that are checked for nested AGENTS.md files. */
const MAX_NESTED_RULE_DIRECTORIES = 24;

const DIRECTORY_RULE_FILES: [string, ProjectRuleSource][] = [
  ["AGENTS.md", "agents"],
  ["CLAUDE.md", "claude"],
];
const RULE_DIRECTORIES: [string, ProjectRuleSource][] = [
  [".athas/rules", "athas"],
  [".cursor/rules", "cursor"],
];

interface RuleFrontmatter {
  description?: string;
  globs: string[];
  alwaysApply?: boolean;
}

function unquote(value: string) {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function splitGlobs(value: string) {
  const list = value.trim().replace(/^\[(.*)\]$/, "$1");
  return list.split(",").map(unquote).filter(Boolean);
}

/** Reads Cursor-style `.mdc` frontmatter: `description`, `globs` and `alwaysApply`. */
export function parseRuleFrontmatter(content: string): {
  attributes: RuleFrontmatter | null;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return { attributes: null, body: content };

  const attributes: RuleFrontmatter = { globs: [] };
  let listKey: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item && listKey === "globs") {
      attributes.globs.push(...splitGlobs(item[1]));
      continue;
    }
    const pair = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, value] = pair;
    listKey = value.trim() ? null : key;
    if (key === "description" && value.trim()) attributes.description = unquote(value);
    if (key === "globs" && value.trim()) attributes.globs.push(...splitGlobs(value));
    if (key === "alwaysApply") attributes.alwaysApply = unquote(value).toLowerCase() === "true";
  }

  return { attributes, body: content.slice(match[0].length) };
}

/**
 * Matches a rule glob against a path relative to the project root. A glob without a slash
 * matches the file name anywhere, as editors treat `*.tsx`.
 */
export function matchesRuleGlob(glob: string, relativePath: string): boolean {
  const pattern = glob.trim().replace(/^\.\//, "");
  if (!pattern) return false;
  const target = pattern.includes("/") ? relativePath : (relativePath.split("/").pop() ?? "");

  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      const followedBySlash = pattern[index + 2] === "/";
      source += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      const end = pattern.indexOf("}", index);
      if (end < 0) {
        source += "\\{";
        continue;
      }
      const options = pattern.slice(index + 1, end).split(",");
      source += `(?:${options.map((option) => option.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`;
      index = end;
    } else {
      source += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
  }

  try {
    return new RegExp(`^${source}$`).test(target);
  } catch {
    return false;
  }
}

/** CLAUDE.md files that only import AGENTS.md add nothing of their own. */
function isImportOnly(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .every((line) => /^@\S+$/.test(line));
}

function ruleFromFile(
  source: ProjectRuleSource,
  path: string,
  content: string,
  scope?: string,
): ProjectRule | null {
  const { attributes, body } = parseRuleFrontmatter(content);
  const text = body.trim();
  if (!text || isImportOnly(text)) return null;
  const globs = attributes?.globs ?? [];
  return {
    source,
    path,
    description: attributes?.description,
    // Plain markdown rules apply always; frontmatter rules follow its settings.
    alwaysApply: attributes ? Boolean(attributes.alwaysApply) : true,
    globs,
    scope,
    content: text,
  };
}

async function getDefaultReader(projectRoot: string): Promise<ProjectRuleReader> {
  const { getWorkspaceResourceProvider } =
    await import("@/features/file-system/services/workspace-resource-provider");
  const provider = getWorkspaceResourceProvider(projectRoot);
  return {
    readDirectory: (path) => provider.readDirectory(path, projectRoot),
    readText: (path) => provider.readText(path),
  };
}

function toRelative(path: string, projectRoot: string) {
  return normalizePath(getRelativePath(path, projectRoot));
}

/** The files a request is about, used to scope nested and glob rules. */
export function collectRuleContextPaths(context: ContextInfo): string[] {
  const paths = new Set<string>();
  const add = (path?: string) => {
    if (path && context.projectRoot && pathStartsWithRoot(path, context.projectRoot)) {
      paths.add(path);
    }
  };
  if (context.activeBuffer && "path" in context.activeBuffer) add(context.activeBuffer.path);
  for (const buffer of context.openBuffers ?? []) if ("path" in buffer) add(buffer.path);
  for (const path of context.selectedProjectFiles ?? []) add(path);
  for (const file of context.mentionedFiles ?? []) add(file.path);
  for (const selection of context.editorSelections ?? []) add(selection.filePath);
  return Array.from(paths);
}

function nestedDirectories(projectRoot: string, contextPaths: string[]) {
  const directories = new Set<string>();
  for (const path of contextPaths) {
    const segments = toRelative(path, projectRoot).split("/").filter(Boolean);
    for (let depth = 1; depth < segments.length; depth++) {
      directories.add(segments.slice(0, depth).join("/"));
    }
  }
  return Array.from(directories)
    .sort((left, right) => left.split("/").length - right.split("/").length)
    .slice(0, MAX_NESTED_RULE_DIRECTORIES);
}

function describeRule(rule: ProjectRule) {
  if (rule.source === "user") return "User rules";
  const scope = rule.scope ? ` (applies to files under ${rule.scope}/)` : "";
  const globs =
    !rule.alwaysApply && rule.globs.length ? ` (applies to ${rule.globs.join(", ")})` : "";
  return `${rule.path}${scope}${globs}`;
}

/** Renders loaded rules as a prompt section, cutting rules that do not fit the budget. */
export function formatProjectRules(
  rules: ProjectRule[],
  available: ProjectRule[],
  maxTokens: number = PROJECT_RULES_MAX_TOKENS,
): Omit<LoadedProjectRules, "rules" | "available"> {
  if (rules.length === 0 && available.length === 0)
    return { text: "", tokens: 0, truncated: false };

  const header =
    "Project rules (from the repository and the user's settings; follow them unless the user's request conflicts):";
  let remaining = maxTokens - estimateTokens(header);
  let truncated = false;
  const sections: string[] = [];
  const omitted: string[] = [];

  for (const rule of rules) {
    const title = `## ${describeRule(rule)}`;
    const allowance = Math.min(PROJECT_RULE_MAX_TOKENS, remaining - estimateTokens(title) - 1);
    if (allowance < 200) {
      truncated = true;
      if (rule.path) omitted.push(rule.path);
      continue;
    }
    const body = truncateTextToTokens(rule.content, allowance);
    truncated ||= body.truncated;
    const section = `${title}\n${body.text}`;
    remaining -= estimateTokens(section) + 1;
    sections.push(section);
  }

  if (omitted.length) {
    sections.push(
      `[truncated: ${omitted.length} more rule files did not fit; read them when relevant: ${omitted.join(", ")}]`,
    );
  }
  if (available.length) {
    const lines = available.map((rule) => `- ${rule.path}: ${rule.description}`);
    sections.push(
      `Other rules (read the file when its description is relevant):\n${lines.join("\n")}`,
    );
  }

  const text = `${header}\n\n${sections.join("\n\n")}`;
  return { text, tokens: estimateTokens(text), truncated };
}

export interface LoadProjectRulesOptions {
  projectRoot: string;
  /** Absolute paths of the files the request is about. */
  contextPaths?: string[];
  /** Rules the user keeps for every project, placed first. */
  userRules?: string;
  maxTokens?: number;
  reader?: ProjectRuleReader;
}

/**
 * Loads the rules best-in-class editors honour: AGENTS.md and CLAUDE.md at the root and in the
 * directories of attached files, `.athas/rules` and `.cursor/rules` with their frontmatter, and
 * the legacy `.cursorrules` file. Files that cannot be read are skipped.
 */
export async function loadProjectRules({
  projectRoot,
  contextPaths = [],
  userRules,
  maxTokens = PROJECT_RULES_MAX_TOKENS,
  reader,
}: LoadProjectRulesOptions): Promise<LoadedProjectRules> {
  const io = reader ?? (await getDefaultReader(projectRoot));
  const listing = new Map<string, Promise<Set<string>>>();
  const listDirectory = (relativeDirectory: string) => {
    let entries = listing.get(relativeDirectory);
    if (!entries) {
      const directory = relativeDirectory ? joinPath(projectRoot, relativeDirectory) : projectRoot;
      entries = io
        .readDirectory(directory)
        .then((items) => new Set(items.filter((item) => !item.isDir).map((item) => item.name)))
        .catch(() => new Set<string>());
      listing.set(relativeDirectory, entries);
    }
    return entries;
  };
  const read = async (relativePath: string) => {
    try {
      return await io.readText(joinPath(projectRoot, relativePath));
    } catch {
      return null;
    }
  };

  const loadDirectoryRules = async (relativeDirectory: string) => {
    const names = await listDirectory(relativeDirectory);
    const rules: ProjectRule[] = [];
    for (const [name, source] of DIRECTORY_RULE_FILES) {
      if (!names.has(name)) continue;
      const path = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const content = await read(path);
      const rule = content && ruleFromFile(source, path, content, relativeDirectory || undefined);
      if (rule) rules.push({ ...rule, alwaysApply: true, globs: [] });
    }
    return rules;
  };

  const relativeContextPaths = contextPaths.map((path) => toRelative(path, projectRoot));
  const [rootRules, nestedRules, folderRules, legacyCursorRules] = await Promise.all([
    loadDirectoryRules(""),
    Promise.all(nestedDirectories(projectRoot, contextPaths).map(loadDirectoryRules)).then(
      (groups) => groups.flat(),
    ),
    Promise.all(
      RULE_DIRECTORIES.map(async ([directory, source]) => {
        const names = Array.from(await listDirectory(directory))
          .filter((name) => /\.(md|mdc)$/i.test(name))
          .sort();
        const rules = await Promise.all(
          names.map(async (name) => {
            const path = `${directory}/${name}`;
            const content = await read(path);
            return content ? ruleFromFile(source, path, content) : null;
          }),
        );
        return rules.filter((rule): rule is ProjectRule => rule !== null);
      }),
    ).then((groups) => groups.flat()),
    listDirectory("").then(async (names) => {
      if (!names.has(".cursorrules")) return [];
      const content = await read(".cursorrules");
      const rule = content && ruleFromFile("cursor", ".cursorrules", content);
      return rule ? [rule] : [];
    }),
  ]);

  const applied: ProjectRule[] = [];
  const available: ProjectRule[] = [];
  if (userRules?.trim()) {
    applied.push({ source: "user", alwaysApply: true, globs: [], content: userRules.trim() });
  }
  const seen = new Set<string>();
  const include = (rule: ProjectRule) => {
    const key = rule.content.trim();
    if (seen.has(key)) return;
    seen.add(key);
    applied.push(rule);
  };
  for (const rule of [...rootRules, ...nestedRules]) include(rule);
  for (const rule of [...folderRules, ...legacyCursorRules]) {
    if (rule.alwaysApply) include(rule);
    else if (
      rule.globs.some((glob) => relativeContextPaths.some((path) => matchesRuleGlob(glob, path)))
    )
      include(rule);
    else if (rule.description) available.push(rule);
  }

  return { rules: applied, available, ...formatProjectRules(applied, available, maxTokens) };
}

/**
 * Rules for a built-in agent request. Rule loading never blocks a request: when the project
 * cannot be read, the request goes out without rules.
 */
export async function loadContextProjectRules(
  context: ContextInfo,
  options: Pick<LoadProjectRulesOptions, "userRules" | "reader"> = {},
): Promise<LoadedProjectRules | undefined> {
  if (!context.projectRoot) return undefined;
  try {
    return await loadProjectRules({
      projectRoot: context.projectRoot,
      contextPaths: collectRuleContextPaths(context),
      ...options,
    });
  } catch (error) {
    console.warn("Failed to load project rules:", error);
    return undefined;
  }
}
