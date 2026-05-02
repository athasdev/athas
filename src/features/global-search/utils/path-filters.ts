import { getRelativePath } from "@/utils/path-helpers";

function globToRegExp(glob: string): RegExp | null {
  const trimmed = glob.trim();
  if (!trimmed) return null;

  let source = "";
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    const next = trimmed[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index++;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }

  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

function splitGlobQuery(query: string): string[] {
  return query
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function pathMatchesAny(path: string, globs: string[]): boolean {
  return globs.some((glob) => {
    const matcher = globToRegExp(glob);
    return matcher ? matcher.test(path) : path.toLowerCase().includes(glob.toLowerCase());
  });
}

export function matchesPathFilters(
  path: string,
  rootFolderPath: string | null | undefined,
  includeQuery: string,
  excludeQuery: string,
): boolean {
  const relativePath = getRelativePath(path, rootFolderPath);
  const includeGlobs = splitGlobQuery(includeQuery);
  const excludeGlobs = splitGlobQuery(excludeQuery);

  if (includeGlobs.length > 0 && !pathMatchesAny(relativePath, includeGlobs)) {
    return false;
  }

  if (excludeGlobs.length > 0 && pathMatchesAny(relativePath, excludeGlobs)) {
    return false;
  }

  return true;
}
