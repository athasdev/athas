/**
 * Which shell commands Athas's own agent may run without asking. Only simple commands qualify:
 * one program with plain arguments, no pipes, redirects, substitutions, chaining, or variables,
 * so an approved prefix can never smuggle a second command along with it.
 */

const SHELL_SYNTAX = /[;&|<>`$\\\n\r(){}]/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Programs whose first argument names what they do, so a prefix keeps it: `bun test`. */
const SUBCOMMAND_PROGRAMS = new Set([
  "bun",
  "bunx",
  "cargo",
  "deno",
  "docker",
  "dotnet",
  "gh",
  "git",
  "go",
  "gradle",
  "kubectl",
  "make",
  "mvn",
  "npm",
  "npx",
  "pnpm",
  "poetry",
  "uv",
  "vp",
  "yarn",
]);

/** Programs that are never run without asking, whatever the user allowed before. */
const DESTRUCTIVE_PROGRAMS = new Set([
  "chmod",
  "chown",
  "curl",
  "dd",
  "del",
  "doas",
  "erase",
  "format",
  "kill",
  "killall",
  "mkfs",
  "mv",
  "pkill",
  "rd",
  "reboot",
  "rm",
  "rmdir",
  "shutdown",
  "su",
  "sudo",
  "truncate",
  "wget",
]);

const DESTRUCTIVE_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set([
    "checkout",
    "clean",
    "filter-branch",
    "gc",
    "push",
    "rebase",
    "reset",
    "restore",
    "rm",
    "stash",
    "switch",
    "update-ref",
  ]),
  docker: new Set(["rm", "rmi", "prune", "kill", "stop", "system", "volume"]),
  kubectl: new Set(["delete", "drain", "apply", "replace", "scale"]),
  npm: new Set(["publish", "unpublish"]),
  cargo: new Set(["publish"]),
  gh: new Set(["repo", "release", "secret"]),
};

/** Read-only commands that run without asking: they cannot change files or reach the network. */
const SAFE_PROGRAMS = new Set([
  "cat",
  "du",
  "file",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "stat",
  "tail",
  "tree",
  "wc",
  "which",
]);

const SAFE_GIT_SUBCOMMANDS = new Set([
  "blame",
  "diff",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status",
]);

/** Flags that turn an otherwise read-only command into one that writes or runs something. */
const UNSAFE_FLAGS =
  /^(--output|--ext-diff|--exec|--pre\b|--pre=|-exec|-execdir|-ok|-delete|-fprint)/;

/**
 * Flags that make one program write, run something, or read past the workspace's ignore rules:
 * `sed -i` edits in place, `tree -o` and `file -C` write files, `rg --hostname-bin` runs a
 * program, and a recursive `grep` reads ignored secrets such as `.env`.
 */
const UNSAFE_PROGRAM_FLAGS: Record<string, RegExp> = {
  sed: /^(-[a-zA-Z]*i|--in-place)/,
  perl: /^-[a-zA-Z]*i/,
  tree: /^(-[a-zA-Z]*o|--output)/,
  file: /^(-[a-zA-Z]*C|--compile)/,
  rg: /^--hostname-bin/,
  grep: /^(-[a-zA-Z]*[rR]|--recursive|--dereference-recursive)/,
};

/** Shell wildcards: the shell expands them to paths the checks below never saw. */
const GLOB = /[*?[]/;

const SECRET_ARGUMENT = /(^|[/:])\.env(\.|$)|\.(pem|key|p12|pfx)$|id_(rsa|ed25519|ecdsa|dsa)/i;

/** The part of an argument that can name a path: the word itself, or a flag's value. */
function argumentValue(word: string): string | null {
  if (!word.startsWith("-")) return word;
  if (word.includes("=")) return word.slice(word.indexOf("=") + 1);
  // A short flag can carry its value attached, as in `-f/etc/passwd`.
  return !word.startsWith("--") && word.length > 2 ? word.slice(2) : null;
}

/**
 * The arguments of a simple command that could name files, for checking where they lead once
 * symbolic links are followed. Empty for a command with shell syntax, which never runs unasked.
 */
export function getCommandPathArguments(command: string): string[] {
  const words = splitSimpleCommand(command);
  if (!words) return [];
  return words
    .slice(1)
    .map(argumentValue)
    .filter((value): value is string => Boolean(value));
}

/**
 * Arguments that stay inside the workspace and away from credentials: no absolute or home paths,
 * no `..`, no secret files. Commands run without asking only when every argument passes, since
 * their output goes to the model provider.
 */
function argumentsStayInWorkspace(words: string[]) {
  return words.slice(1).every((word) => {
    if (GLOB.test(word)) return false;
    const value = argumentValue(word);
    if (value === null) return true;
    return (
      !/^(\/|~|[A-Za-z]:)/.test(value) &&
      !value.split(/[\\/]/).includes("..") &&
      !SECRET_ARGUMENT.test(value)
    );
  });
}

/** Splits a simple command into words; null when it uses shell syntax or unbalanced quotes. */
export function splitSimpleCommand(command: string): string[] | null {
  const trimmed = command.trim();
  if (!trimmed || SHELL_SYNTAX.test(trimmed)) return null;
  const words: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of trimmed) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) words.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (quote) return null;
  if (started) words.push(current);
  if (words.length === 0 || ENV_ASSIGNMENT.test(words[0])) return null;
  return words;
}

function programName(word: string) {
  return (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.exe$/, "");
}

function isDestructive(words: string[]) {
  const program = programName(words[0]);
  if (DESTRUCTIVE_PROGRAMS.has(program)) return true;
  const subcommand = words[1]?.toLowerCase();
  if (subcommand && DESTRUCTIVE_SUBCOMMANDS[program]?.has(subcommand)) return true;
  if (program === "git" && subcommand === "branch" && words.some((word) => /^-[dDmMcC]/.test(word)))
    return true;
  return false;
}

function hasUnsafeFlag(words: string[]) {
  const programFlags = UNSAFE_PROGRAM_FLAGS[programName(words[0])];
  return words
    .slice(1)
    .some((word) => UNSAFE_FLAGS.test(word) || Boolean(programFlags?.test(word)));
}

/**
 * Whether a program that takes a subcommand got an option before it, as in `git -c k=v log`.
 * Global options can run programs or change what the subcommand does, and they hide the
 * subcommand from the destructive check.
 */
function hasGlobalOption(words: string[]) {
  return SUBCOMMAND_PROGRAMS.has(programName(words[0])) && Boolean(words[1]?.startsWith("-"));
}

/** A read-only command from the built-in list, safe to run without asking. */
export function isBuiltInSafeCommand(command: string): boolean {
  const words = splitSimpleCommand(command);
  if (!words || !argumentsStayInWorkspace(words)) return false;
  if (hasUnsafeFlag(words)) return false;
  const program = programName(words[0]);
  if (program !== words[0]) return false;
  if (program === "git") {
    const subcommand = words[1];
    if (subcommand === "branch")
      return words.slice(2).every((word) => /^(-a|-r|-v|-vv|--list|--show-current)$/.test(word));
    return Boolean(subcommand && SAFE_GIT_SUBCOMMANDS.has(subcommand));
  }
  if (program === "find") return false;
  return SAFE_PROGRAMS.has(program);
}

/**
 * The prefix an "always allow" answer remembers for `command`, such as `bun test` or `ls`; null
 * when the command must always be confirmed: it uses shell syntax or can destroy data.
 */
export function getCommandAllowPrefix(command: string): string | null {
  const words = splitSimpleCommand(command);
  if (!words || isDestructive(words) || hasGlobalOption(words)) return null;
  const program = words[0];
  const subcommand = words[1];
  if (
    SUBCOMMAND_PROGRAMS.has(programName(program)) &&
    subcommand &&
    /^[a-z][\w:.-]*$/i.test(subcommand)
  )
    return `${program} ${subcommand}`;
  return program;
}

/** Whether `command` starts with one of the remembered prefixes and is still safe to run. */
export function matchesAllowedPrefix(command: string, prefixes: readonly string[]): boolean {
  const words = splitSimpleCommand(command);
  if (
    !words ||
    isDestructive(words) ||
    hasGlobalOption(words) ||
    hasUnsafeFlag(words) ||
    !argumentsStayInWorkspace(words)
  )
    return false;
  return prefixes.some((prefix) => {
    const prefixWords = prefix.split(" ");
    return prefixWords.every((word, index) => words[index] === word);
  });
}
