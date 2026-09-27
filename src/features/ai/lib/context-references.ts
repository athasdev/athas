import { estimateTokens, truncateTextToTokens } from "@/features/ai/lib/context-budget";
import {
  buildConversationHistory,
  summarizeConversationExtractively,
} from "@/features/ai/lib/conversation-history";
import type {
  ContextReference,
  ContextReferenceEntry,
  ContextReferenceSources,
  GitDiffScope,
  ResolvedContextReference,
} from "@/features/ai/types/context-references.types";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";
import type { GitDiff } from "@/features/git/types/git.types";
import { getBaseName, getRelativePath, joinPath, normalizePath } from "@/utils/path-helpers";

const PREFIX = "athas-context:";

/** Token budgets per reference; one reference never crowds out the rest of the request. */
export const CONTEXT_REFERENCE_BUDGETS = {
  folder: 8_000,
  gitDiff: 12_000,
  problems: 4_000,
  chat: 3_000,
} as const;

const FOLDER_MAX_ENTRIES = 400;
const FOLDER_MAX_DEPTH = 6;
const FOLDER_MAX_FILE_READS = 40;
/** Folder files larger than this are listed in the tree but not inlined. */
const FOLDER_SMALL_FILE_TOKENS = 1_500;
const PROBLEMS_MAX_ENTRIES = 200;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);
const BINARY_FILE_PATTERN =
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|icns|pdf|zip|gz|tgz|tar|7z|rar|woff2?|ttf|otf|eot|mp[34]|mov|wav|ogg|webm|wasm|so|dylib|dll|exe|bin|lock|sqlite|db)$/i;

/** Credentials the workspace tools never read; a folder lists them but never inlines them. */
const SECRET_FILE_PATTERN = /^\.env($|\.)|\.(pem|key|p12|pfx)$|^id_(rsa|ed25519|ecdsa|dsa)/i;

export function formatContextReference(reference: ContextReference): string {
  switch (reference.kind) {
    case "folder":
      return `${PREFIX}folder:${encodeURIComponent(reference.path)}`;
    case "gitDiff":
      return `${PREFIX}git-diff:${reference.scope}`;
    case "problems":
      return `${PREFIX}problems`;
    case "chat":
      return `${PREFIX}chat:${encodeURIComponent(reference.chatId)}:${encodeURIComponent(reference.title)}`;
  }
}

export function isContextReference(value: string): boolean {
  return value.startsWith(PREFIX);
}

function decode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseContextReference(value: string): ContextReference | null {
  if (!isContextReference(value)) return null;
  const [kind, ...rest] = value.slice(PREFIX.length).split(":");
  if (kind === "folder" && rest.length === 1) {
    const path = decode(rest[0]);
    return path ? { kind: "folder", path } : null;
  }
  if (kind === "git-diff" && (rest[0] === "working" || rest[0] === "staged")) {
    return { kind: "gitDiff", scope: rest[0] };
  }
  if (kind === "problems" && rest.length === 0) return { kind: "problems" };
  if (kind === "chat" && rest.length === 2) {
    const chatId = decode(rest[0]);
    const title = decode(rest[1]);
    return chatId && title !== null ? { kind: "chat", chatId, title } : null;
  }
  return null;
}

/** A short name and a description for chips and the attachment list. */
export function describeContextReference(
  reference: ContextReference,
  projectRoot?: string | null,
): { name: string; description: string } {
  switch (reference.kind) {
    case "folder":
      return {
        name: `${getBaseName(reference.path)}/`,
        description: getRelativePath(reference.path, projectRoot) || reference.path,
      };
    case "gitDiff":
      return reference.scope === "staged"
        ? { name: "Staged changes", description: "git diff --staged" }
        : { name: "Working tree changes", description: "git diff" };
    case "problems":
      return { name: "Problems", description: "Current errors and warnings" };
    case "chat":
      return { name: reference.title || "Untitled chat", description: "Past chat summary" };
  }
}

/** Splits composer selections into plain file paths and context references. */
export function partitionContextSelections(values: Iterable<string>) {
  const filePaths: string[] = [];
  const references: string[] = [];
  for (const value of values) (isContextReference(value) ? references : filePaths).push(value);
  return { filePaths, references };
}

function fit(content: string, maxTokens: number) {
  const result = truncateTextToTokens(content, maxTokens);
  return { content: result.text, truncated: result.truncated };
}

async function resolveFolder(
  path: string,
  sources: ContextReferenceSources,
): Promise<{ content: string; truncated: boolean }> {
  const tree: string[] = [];
  const files: { path: string; relativePath: string; depth: number }[] = [];
  let truncated = false;
  const queue: { path: string; depth: number }[] = [{ path, depth: 0 }];
  let entryCount = 0;

  while (queue.length > 0) {
    const directory = queue.shift() as { path: string; depth: number };
    let entries: ContextReferenceEntry[];
    try {
      entries = await sources.readDirectory(directory.path);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entryCount >= FOLDER_MAX_ENTRIES) {
        truncated = true;
        break;
      }
      entryCount++;
      const relativePath = normalizePath(getRelativePath(entry.path, path));
      tree.push(`${relativePath}${entry.isDir ? "/" : ""}`);
      if (entry.isDir) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        if (directory.depth + 1 < FOLDER_MAX_DEPTH) {
          queue.push({ path: entry.path, depth: directory.depth + 1 });
        } else {
          truncated = true;
        }
      } else if (!BINARY_FILE_PATTERN.test(entry.name) && !SECRET_FILE_PATTERN.test(entry.name)) {
        files.push({ path: entry.path, relativePath, depth: directory.depth });
      }
    }
  }

  tree.sort();
  const sections = [`Folder tree (${tree.length} entries):\n${tree.join("\n")}`];
  let remaining = CONTEXT_REFERENCE_BUDGETS.folder - estimateTokens(sections[0]);
  files.sort(
    (left, right) =>
      left.depth - right.depth || left.relativePath.localeCompare(right.relativePath),
  );
  for (const file of files.slice(0, FOLDER_MAX_FILE_READS)) {
    if (remaining < 200) break;
    let content: string;
    try {
      content = await sources.readText(file.path);
    } catch {
      continue;
    }
    const tokens = estimateTokens(content);
    if (tokens > FOLDER_SMALL_FILE_TOKENS || tokens + 20 > remaining) continue;
    sections.push(`--- ${file.relativePath} ---\n${content}`);
    remaining -= tokens + 20;
  }
  if (files.length > sections.length - 1) {
    sections.push("[Larger or further files are listed in the tree only; read them when needed.]");
  }

  const result = fit(sections.join("\n\n"), CONTEXT_REFERENCE_BUDGETS.folder);
  return { content: result.content, truncated: truncated || result.truncated };
}

export function formatGitDiff(diff: GitDiff): string {
  if (diff.raw_patch) return diff.raw_patch;
  const header = diff.is_new
    ? `new file: ${diff.file_path}`
    : diff.is_deleted
      ? `deleted: ${diff.file_path}`
      : diff.is_renamed
        ? `renamed: ${diff.old_path} -> ${diff.new_path ?? diff.file_path}`
        : `modified: ${diff.file_path}`;
  if (diff.is_binary || diff.is_image) return `${header} (binary)`;
  const lines = diff.lines.map((line) => {
    if (line.line_type === "added") return `+${line.content}`;
    if (line.line_type === "removed") return `-${line.content}`;
    if (line.line_type === "header") return line.content;
    return ` ${line.content}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

async function resolveGitDiff(
  scope: GitDiffScope,
  repoPath: string,
  sources: ContextReferenceSources,
): Promise<{ content: string; truncated: boolean }> {
  const status = await sources.getGitStatus(repoPath);
  if (!status) return { content: "Not a Git repository.", truncated: false };
  const staged = scope === "staged";
  const files = status.files.filter((file) => file.staged === staged);
  if (files.length === 0) {
    return { content: staged ? "No staged changes." : "No unstaged changes.", truncated: false };
  }

  const summary = files.map((file) => `${file.status}: ${file.path}`).join("\n");
  const sections = [`Branch: ${status.branch}\n${summary}`];
  let remaining = CONTEXT_REFERENCE_BUDGETS.gitDiff - estimateTokens(sections[0]);
  let truncated = false;
  for (const file of files) {
    if (remaining < 200) {
      truncated = true;
      break;
    }
    const diff = await sources.getFileDiff(repoPath, file.path, staged).catch(() => null);
    if (!diff) continue;
    const patch = truncateTextToTokens(formatGitDiff(diff), Math.min(remaining, 4_000));
    truncated ||= patch.truncated || Boolean(diff.is_truncated);
    sections.push(patch.text);
    remaining -= estimateTokens(patch.text);
  }
  const result = fit(sections.join("\n\n"), CONTEXT_REFERENCE_BUDGETS.gitDiff);
  return { content: result.content, truncated: truncated || result.truncated };
}

const SEVERITY_ORDER: Record<Diagnostic["severity"], number> = { error: 0, warning: 1, info: 2 };

export function formatDiagnostics(diagnostics: Diagnostic[], projectRoot?: string | null) {
  const sorted = [...diagnostics].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.filePath.localeCompare(right.filePath) ||
      left.line - right.line,
  );
  const counts = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) counts[diagnostic.severity]++;
  const lines = sorted.slice(0, PROBLEMS_MAX_ENTRIES).map((diagnostic) => {
    const path = getRelativePath(diagnostic.filePath, projectRoot);
    const origin = [diagnostic.source, diagnostic.code].filter(Boolean).join(" ");
    return `${path}:${diagnostic.line + 1}:${diagnostic.column + 1} ${diagnostic.severity}: ${diagnostic.message.replace(/\s+/g, " ")}${origin ? ` (${origin})` : ""}`;
  });
  const more = sorted.length - lines.length;
  return [
    `${counts.error} errors, ${counts.warning} warnings, ${counts.info} infos`,
    ...lines,
    ...(more > 0 ? [`... and ${more} more`] : []),
  ].join("\n");
}

async function resolveChat(
  chatId: string,
  sources: ContextReferenceSources,
): Promise<{ content: string; truncated: boolean }> {
  const history = await sources.loadChatHistory(chatId);
  if (!history) return { content: "This chat no longer exists.", truncated: false };
  return fit(summarizeConversationExtractively(history), CONTEXT_REFERENCE_BUDGETS.chat);
}

async function getDefaultSources(projectRoot: string): Promise<ContextReferenceSources> {
  const [
    { getWorkspaceResourceProvider },
    { getGitStatus },
    { getFileDiff },
    { useDiagnosticsStore },
    { useAIChatStore },
    { loadChatFromDb },
  ] = await Promise.all([
    import("@/features/file-system/services/workspace-resource-provider"),
    import("@/features/git/api/git-status-api"),
    import("@/features/git/api/git-diff-api"),
    import("@/features/diagnostics/stores/diagnostics.store"),
    import("@/features/ai/stores/ai-chat.store"),
    import("@/features/ai/services/ai-chat-history-service"),
  ]);
  const provider = getWorkspaceResourceProvider(projectRoot);
  return {
    readDirectory: (path) => provider.readDirectory(path, projectRoot),
    readText: (path) => provider.readText(path),
    getGitStatus,
    getFileDiff,
    getDiagnostics: () => useDiagnosticsStore.getState().actions.getAllDiagnostics(),
    async loadChatHistory(chatId) {
      const loaded = useAIChatStore.getState().chats.find((chat) => chat.id === chatId);
      const messages = loaded?.messages.length
        ? loaded.messages
        : (await loadChatFromDb(chatId).catch(() => null))?.messages;
      return messages ? buildConversationHistory(messages) : null;
    },
  };
}

export interface ResolveContextReferencesOptions {
  projectRoot?: string | null;
  /** The Git repository for diffs; defaults to the project root. */
  repoPath?: string | null;
  sources?: ContextReferenceSources;
}

/**
 * Turns serialized references into prompt sections. A reference that cannot be resolved
 * becomes a short note instead of failing the request.
 */
export async function resolveContextReferences(
  values: string[],
  { projectRoot, repoPath, sources }: ResolveContextReferencesOptions = {},
): Promise<ResolvedContextReference[]> {
  const references = values
    .map((value) => ({ id: value, reference: parseContextReference(value) }))
    .filter(
      (entry): entry is { id: string; reference: ContextReference } => entry.reference !== null,
    );
  if (references.length === 0) return [];
  const io = sources ?? (projectRoot ? await getDefaultSources(projectRoot) : null);
  let diffRepoPath = repoPath || projectRoot || "";
  if (!repoPath && !sources && references.some(({ reference }) => reference.kind === "gitDiff")) {
    const { useGitStore } = await import("@/features/git/stores/git.store");
    diffRepoPath = useGitStore.getState().currentWorkspaceRepoPath || diffRepoPath;
  }

  return Promise.all(
    references.map(async ({ id, reference }) => {
      const { name, description } = describeContextReference(reference, projectRoot);
      const label = reference.kind === "chat" ? `Past chat: ${name}` : `${name} (${description})`;
      if (!io) return { id, label, content: "No project is open.", truncated: false };
      try {
        const resolved =
          reference.kind === "folder"
            ? await resolveFolder(reference.path, io)
            : reference.kind === "gitDiff"
              ? await resolveGitDiff(reference.scope, diffRepoPath, io)
              : reference.kind === "problems"
                ? fit(
                    formatDiagnostics(io.getDiagnostics(), projectRoot),
                    CONTEXT_REFERENCE_BUDGETS.problems,
                  )
                : await resolveChat(reference.chatId, io);
        return { id, label, ...resolved };
      } catch (error) {
        console.warn(`Failed to resolve context ${id}:`, error);
        return { id, label, content: "This context could not be loaded.", truncated: false };
      }
    }),
  );
}

/** Project folders the user can attach, from the flattened project file list. */
export function listProjectFolders(
  entries: readonly ContextReferenceEntry[],
  projectRoot: string | null | undefined,
): { path: string; relativePath: string }[] {
  if (!projectRoot) return [];
  const folders = new Map<string, string>();
  const add = (path: string) => {
    const relativePath = normalizePath(getRelativePath(path, projectRoot));
    if (!relativePath || relativePath === path) return;
    if (relativePath.split("/").some((segment) => IGNORED_DIRECTORIES.has(segment))) return;
    folders.set(relativePath, path);
  };
  for (const entry of entries) {
    if (entry.isDir) add(entry.path);
    else {
      const separator = Math.max(entry.path.lastIndexOf("/"), entry.path.lastIndexOf("\\"));
      if (separator > 0) add(entry.path.slice(0, separator));
    }
  }
  for (const relativePath of Array.from(folders.keys())) {
    const segments = relativePath.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
      const parent = segments.slice(0, depth).join("/");
      if (!folders.has(parent)) folders.set(parent, joinPath(projectRoot, parent));
    }
  }
  return Array.from(folders, ([relativePath, path]) => ({ path, relativePath })).sort(
    (left, right) => left.relativePath.localeCompare(right.relativePath),
  );
}
