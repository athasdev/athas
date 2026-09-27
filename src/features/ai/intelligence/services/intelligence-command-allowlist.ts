import {
  getCommandAllowPrefix,
  isBuiltInSafeCommand,
  matchesAllowedPrefix,
} from "../lib/intelligence-command-policy";

const STORAGE_KEY = "athas.intelligence.command-allowlist.v1";
const MAX_PREFIXES_PER_WORKSPACE = 200;

type Allowlist = Record<string, string[]>;

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function workspaceKey(root: string) {
  return root.replace(/[/\\]+$/, "");
}

function readAllowlist(): Allowlist {
  try {
    const parsed = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Allowlist = {};
    for (const [root, prefixes] of Object.entries(parsed)) {
      if (Array.isArray(prefixes))
        result[root] = prefixes.filter((prefix): prefix is string => typeof prefix === "string");
    }
    return result;
  } catch {
    return {};
  }
}

function writeAllowlist(allowlist: Allowlist) {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(allowlist));
  } catch {
    // Storage is full or unavailable; the command still runs this once.
  }
}

/** Every always-allowed command prefix, by workspace root. */
export function getAllAllowedCommandPrefixes(): Allowlist {
  return Object.fromEntries(
    Object.entries(readAllowlist()).filter(([, prefixes]) => prefixes.length > 0),
  );
}

/** Stops `prefix` from running without asking in `root`. */
export function removeAllowedCommandPrefix(root: string, prefix: string) {
  const allowlist = readAllowlist();
  const key = workspaceKey(root);
  const prefixes = (allowlist[key] ?? []).filter((entry) => entry !== prefix);
  if (prefixes.length) allowlist[key] = prefixes;
  else delete allowlist[key];
  writeAllowlist(allowlist);
}

/** The command prefixes the user chose to always allow in this workspace. */
export function getAllowedCommandPrefixes(root: string): string[] {
  return readAllowlist()[workspaceKey(root)] ?? [];
}

/**
 * Remembers `command`'s prefix for this workspace. Returns the prefix, or null when the command
 * cannot be allowed permanently.
 */
export function allowCommandPrefix(root: string, command: string): string | null {
  const prefix = getCommandAllowPrefix(command);
  if (!prefix) return null;
  const allowlist = readAllowlist();
  const key = workspaceKey(root);
  const prefixes = allowlist[key] ?? [];
  if (!prefixes.includes(prefix)) {
    allowlist[key] = [...prefixes, prefix].slice(-MAX_PREFIXES_PER_WORKSPACE);
    writeAllowlist(allowlist);
  }
  return prefix;
}

/** Whether `command` may run in `root` without asking, and why. */
export function getCommandAutoApproval(
  root: string,
  command: string,
): "built-in" | "allowed" | null {
  if (isBuiltInSafeCommand(command)) return "built-in";
  if (matchesAllowedPrefix(command, getAllowedCommandPrefixes(root))) return "allowed";
  return null;
}
