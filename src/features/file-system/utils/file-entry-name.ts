import { parseRemotePath } from "@/features/remote/services/remote-path";
import { parseWslPath } from "@/features/wsl/services/wsl-path";
import { IS_WINDOWS } from "@/utils/platform";

const WINDOWS_RESERVED_CHARACTERS = /[<>:"|?*]/;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const CONTROL_CHARACTERS = /\p{Cc}/u;

/**
 * Whether names in the folder at `path` follow Windows rules. Remote and WSL folders live on
 * Linux, whatever the app runs on.
 */
function usesWindowsNameRules(path: string | undefined, isWindows: boolean): boolean {
  if (!isWindows) return false;
  return !path || (!parseRemotePath(path) && !parseWslPath(path));
}

/**
 * Why `name` cannot name a single file or folder, or null when it can. `parentPath` is the folder
 * it would live in and decides which platform's rules apply.
 */
export function getFileEntryNameError(
  name: string,
  parentPath?: string,
  isWindows = IS_WINDOWS,
): string | null {
  if (!name.trim()) return "A name is required.";
  if (name !== name.trim()) return "Names cannot start or end with a space.";
  if (name === "." || name === "..") return `"${name}" is not a valid name.`;
  if (name.includes("/") || name.includes("\\")) return "Names cannot contain / or \\.";
  if (CONTROL_CHARACTERS.test(name)) return "Names cannot contain control characters.";

  if (usesWindowsNameRules(parentPath, isWindows)) {
    if (WINDOWS_RESERVED_CHARACTERS.test(name)) {
      return 'Names cannot contain any of < > : " | ? *';
    }
    if (name.endsWith(".")) return "Names cannot end with a period.";
    if (WINDOWS_RESERVED_NAMES.test(name)) return `"${name}" is reserved by Windows.`;
  }

  return null;
}

/**
 * Splits a typed relative path such as `src/new.ts` into the names to create, or explains why it
 * cannot be used. Each segment must be a valid name, so the path never leaves `parentPath`.
 */
export function parseNewEntryPath(
  input: string,
  parentPath?: string,
  isWindows = IS_WINDOWS,
): { segments: string[] } | { error: string } {
  // Backslash separates folders only where it cannot be part of a name.
  const separator = usesWindowsNameRules(parentPath, isWindows) ? /[\\/]/ : /\//;
  const segments = input
    .trim()
    .split(separator)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return { error: "A name is required." };

  for (const segment of segments) {
    const error = getFileEntryNameError(segment, parentPath, isWindows);
    if (error) return { error };
  }
  return { segments };
}
