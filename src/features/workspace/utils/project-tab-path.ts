import { normalizePath, stripTrailingPathSeparators } from "@/utils/path-helpers";

const URI_ROOT_PATTERN = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)(\/.*)?$/i;

const collapseRepeatedSlashes = (path: string) => path.replace(/\/{2,}/g, "/");

/**
 * The form a workspace root is stored in. Tree walks compare entry paths by prefix, so a root
 * with a repeated or trailing separator would never match its own children. Local paths lose
 * repeated and trailing separators (a leading UNC `\\` or `//` stays). URIs such as
 * `remote://id/` and `wsl://distro/` keep their scheme and authority; only repeated slashes in
 * their path part collapse, and a bare root keeps its slash.
 */
export const normalizeWorkspaceRootPath = (path: string): string => {
  const trimmed = path.trim();
  const uri = URI_ROOT_PATTERN.exec(trimmed);
  if (uri) {
    const [, authority, uriPath] = uri;
    if (!uriPath) return trimmed;
    const collapsedPath = collapseRepeatedSlashes(uriPath);
    return `${authority}${collapsedPath === "/" ? "/" : collapsedPath.replace(/\/+$/, "")}`;
  }

  const uncPrefix = /^[\\/]{2}(?=[^\\/])/.exec(trimmed)?.[0] ?? "";
  const rest = trimmed.slice(uncPrefix.length).replace(/([\\/])[\\/]+/g, "$1");
  return stripTrailingPathSeparators(`${uncPrefix}${rest}`);
};

export const normalizeProjectTabPath = (path: string) =>
  stripTrailingPathSeparators(normalizeWorkspaceRootPath(path));

const isCaseInsensitiveProjectPath = (path: string) => {
  const normalizedPath = normalizePath(path);
  return /^[A-Za-z]:\//.test(normalizedPath) || normalizedPath.startsWith("//");
};

export const areProjectTabPathsEqual = (left: string, right: string) => {
  const normalizedLeft = normalizeProjectTabPath(left);
  const normalizedRight = normalizeProjectTabPath(right);

  if (
    isCaseInsensitiveProjectPath(normalizedLeft) ||
    isCaseInsensitiveProjectPath(normalizedRight)
  ) {
    return (
      normalizePath(normalizedLeft).toLowerCase() === normalizePath(normalizedRight).toLowerCase()
    );
  }

  return normalizedLeft === normalizedRight;
};

export const createProjectTabId = (path: string) => {
  const normalizedPath = normalizePath(normalizeProjectTabPath(path));
  let hash = 5381;

  for (let index = 0; index < normalizedPath.length; index++) {
    hash = (hash * 33) ^ normalizedPath.charCodeAt(index);
  }

  return `project-${(hash >>> 0).toString(36)}`;
};
