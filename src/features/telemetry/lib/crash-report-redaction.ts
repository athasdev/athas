const MAX_CRASH_TEXT_CHARS = 2000;

const QUOTED_TEXT = /"(?:[^"\\\n]|\\.){0,2000}"|'(?:[^'\\\n]|\\.){0,2000}'|`[^`]{0,2000}`/g;
const USER_PATH =
  /(?:file:\/\/)?(?:\/(?:Users|home|private|tmp|var\/folders|Volumes|mnt|media)\/[^\s:)'"`]*|[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s:)'"`]*|~[\\/][^\s:)'"`]*)/g;

/**
 * Strips what a crash report must not carry: quoted text, where error messages echo prompts,
 * model output or file contents, and paths inside the user's home or temporary folders. What is
 * left is the error's shape and the app's own stack frames.
 */
export function redactCrashText(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value
    .replace(QUOTED_TEXT, "<redacted>")
    .replace(USER_PATH, "<path>")
    .slice(0, MAX_CRASH_TEXT_CHARS);
}
