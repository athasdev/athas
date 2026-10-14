const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const POWERSHELLS = new Set(["powershell", "pwsh"]);
const MAX_UNWRAPS = 3;
const MAX_SHORT_WORDS = 3;
const SEPARATORS = new Set(["&&", "||", "|", ";", ">", ">>", "<", "2>", "2>&1", "&"]);

/** Splits a command line into words, honouring single and double quotes and escapes. */
export function splitCommandWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let hasWord = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < command.length) {
        current += command[++index];
      } else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasWord = true;
    } else if (char === "\\" && index + 1 < command.length) {
      current += command[++index];
      hasWord = true;
    } else if (/\s/.test(char)) {
      if (hasWord) words.push(current);
      current = "";
      hasWord = false;
    } else {
      current += char;
      hasWord = true;
    }
  }
  if (hasWord) words.push(current);
  return words;
}

function programName(word: string): string {
  const name = word.split(/[\\/]/).pop() ?? word;
  return name.replace(/\.exe$/i, "").toLowerCase();
}

/** The script a shell wrapper runs, or null when `words` is not a wrapper. */
function unwrapWords(words: string[]): string | null {
  const [program, ...rest] = words;
  if (!program) return null;
  const name = programName(program);

  if (POSIX_SHELLS.has(name)) {
    for (let index = 0; index < rest.length; index++) {
      const word = rest[index];
      if (/^-[a-z]*c[a-z]*$/i.test(word) || word === "--command") {
        return rest[index + 1] ?? null;
      }
      if (!word.startsWith("-")) return null;
    }
    return null;
  }

  if (name === "cmd") {
    const index = rest.findIndex((word) => /^\/[ck]$/i.test(word));
    return index >= 0 ? rest.slice(index + 1).join(" ") || null : null;
  }

  if (POWERSHELLS.has(name)) {
    const index = rest.findIndex((word) => /^-(c|command)$/i.test(word));
    return index >= 0 ? rest.slice(index + 1).join(" ") || null : null;
  }

  return null;
}

/**
 * The command a shell wrapper runs, such as `bun dev` for `/bin/zsh -lc 'bun dev'`,
 * `cmd /c npm test` or `powershell -NoProfile -Command npm test`. Nested wrappers unwrap too.
 * Anything else comes back as it was, trimmed, so the command stays exact.
 */
export function unwrapShellCommand(command: string | readonly string[]): string {
  let current =
    typeof command === "string" ? command.trim() : (unwrapWords([...command]) ?? command.join(" "));
  for (let step = 0; step < MAX_UNWRAPS; step++) {
    const script = unwrapWords(splitCommandWords(current));
    if (script === null) break;
    current = script.trim();
  }
  return current;
}

const VERSION_MANAGERS: Record<string, string[]> = {
  mise: ["exec", "x"],
  asdf: ["exec"],
  nvm: ["exec", "run"],
  fnm: ["exec"],
  volta: ["run"],
};
const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpx"]);
const DLX_RUNNERS = new Set(["pnpm", "yarn"]);
const OPTIONS_WITH_VALUES = new Set(["--using", "--node", "--npm", "--yarn", "--pnpm", "-n"]);
const MAX_LAUNCHERS = 8;

function skipOptions(words: string[], from: number, skipVersions = false): number {
  let index = from;
  while (index < words.length) {
    const word = words[index];
    if (word === "--") return index + 1;
    if (word.startsWith("-")) {
      index += OPTIONS_WITH_VALUES.has(word) ? 2 : 1;
    } else if (skipVersions && (/@/.test(word) || /^v?\d+(\.\d+)*$/.test(word))) {
      index += 1;
    } else break;
  }
  return index;
}

/** Drops what only launches the command: `cd dir &&`, env assignments, version managers. */
function stripLaunchers(input: string[]): string[] {
  let words = input;
  for (let step = 0; step < MAX_LAUNCHERS && words.length > 0; step++) {
    const [first, ...rest] = words;
    const name = programName(first);
    if (name === "cd") {
      const next = words.indexOf("&&");
      if (next < 0) break;
      words = words.slice(next + 1);
    } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      words = rest;
    } else if (name === "env") {
      let index = 0;
      while (index < rest.length && (rest[index].startsWith("-") || rest[index].includes("="))) {
        index += 1;
      }
      words = rest.slice(index);
    } else if (name === "nohup" || name === "time") {
      words = rest;
    } else if (name === "nice") {
      words = rest.slice(skipOptions(rest, 0));
    } else if (VERSION_MANAGERS[name]?.includes(rest[0] ?? "")) {
      const separator = rest.indexOf("--");
      words = rest.slice(separator >= 0 ? separator + 1 : skipOptions(rest, 1, true));
    } else if (PACKAGE_RUNNERS.has(name)) {
      words = rest.slice(skipOptions(rest, 0));
    } else if (DLX_RUNNERS.has(name) && rest[0] === "dlx") {
      words = rest.slice(skipOptions(rest, 1));
    } else break;
  }
  return words;
}

function joinWords(words: string[]): string {
  return words.map((word) => (/\s/.test(word) ? `'${word}'` : word)).join(" ");
}

/**
 * A command as people read it: the shell wrapper, `cd`, env assignments, `nice`/`nohup`/`time`,
 * version managers such as `mise exec node@24 --` and package runners such as `npx` dropped, and
 * the program reduced to its name, so `mise exec node@24 -- ./node_modules/.bin/vp run dev` reads
 * `vp run dev`. For labels only; permission prompts show the exact command.
 */
export function cleanCommand(command: string | readonly string[]): string {
  const words = stripLaunchers(splitCommandWords(unwrapShellCommand(command)));
  if (words.length === 0) return unwrapShellCommand(command);
  const program = words[0].split(/[\\/]/).pop() || words[0];
  return joinWords([program.replace(/\.exe$/i, ""), ...words.slice(1)]);
}

/** A few words naming what a command runs, such as `bun dev` or `npm test`, for a short label. */
export function shortenCommand(command: string): string {
  const words: string[] = [];
  for (const word of splitCommandWords(cleanCommand(command))) {
    if (SEPARATORS.has(word) || word.startsWith("-")) break;
    words.push(word);
    if (words.length === MAX_SHORT_WORDS) break;
  }
  return words.join(" ") || cleanCommand(command);
}

const LONG_RUNNING_WORD = /^(dev|serve|server|start|watch|preview)(:|$)/;
const LONG_RUNNING_PROGRAMS = new Set(["vite", "nodemon", "http-server", "live-server"]);

/** Whether a command is a dev server or watcher, which keeps running by design. */
export function isLongRunningCommand(command: string): boolean {
  const words = splitCommandWords(cleanCommand(command));
  if (LONG_RUNNING_PROGRAMS.has(programName(words[0] ?? ""))) return true;
  return words.some((word) => LONG_RUNNING_WORD.test(word) || word === "--watch" || word === "-w");
}
