import { parseRemotePath } from "@/features/remote/services/remote-path";
import { parseWslPath } from "@/features/wsl/services/wsl-path";

export type SessionLocation =
  | { kind: "local" }
  | { kind: "remote"; host: string }
  | { kind: "wsl"; distro: string };

export interface SessionEnvironment {
  /** The project folder's name, or the name its project tab goes by. */
  name: string;
  /** The folder as the user would type it: `~` for the home folder, the path on the host for a remote. */
  displayPath: string;
  location: SessionLocation;
}

const HOME_PREFIX = /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:[\\/]Users[\\/][^\\/]+)(?=$|[\\/])/;
const MAX_PATH_CHARS = 36;

/** `/Users/me/code/app` as `~/code/app`. */
export function shortenHomePath(path: string): string {
  return path.replace(HOME_PREFIX, "~");
}

/** A long path with its middle folders left out, keeping where it starts and the last two parts. */
export function elidePathMiddle(path: string, maxChars = MAX_PATH_CHARS): string {
  if (path.length <= maxChars) return path;
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const parts = path.split(separator);
  if (parts.length <= 3) return path;
  const head = parts[0] || `${separator}${parts[1]}`;
  const tail = parts.slice(-2).join(separator);
  return `${head}${separator}…${separator}${tail}`;
}

function lastSegment(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Where a session's agent works: the project, its folder, and the machine it is on. */
export function describeSessionEnvironment(
  workspacePath: string,
  projectName?: string | null,
): SessionEnvironment {
  const remote = parseRemotePath(workspacePath);
  if (remote) {
    const host = projectName || remote.connectionId;
    return {
      name: remote.remotePath === "/" ? host : lastSegment(remote.remotePath),
      displayPath: elidePathMiddle(shortenHomePath(remote.remotePath)),
      location: { kind: "remote", host },
    };
  }

  const wsl = parseWslPath(workspacePath);
  if (wsl) {
    return {
      name: projectName || lastSegment(wsl.linuxPath) || wsl.distro,
      displayPath: elidePathMiddle(shortenHomePath(wsl.linuxPath)),
      location: { kind: "wsl", distro: wsl.distro },
    };
  }

  return {
    name: projectName || lastSegment(workspacePath),
    displayPath: elidePathMiddle(shortenHomePath(workspacePath)),
    location: { kind: "local" },
  };
}
