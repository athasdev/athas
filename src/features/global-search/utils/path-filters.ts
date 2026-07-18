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

interface PathFilter {
  matcher: RegExp | null;
  fallback: string;
}

function compilePathFilters(query: string): PathFilter[] {
  return splitGlobQuery(query).map((glob) => ({
    matcher: globToRegExp(glob),
    fallback: glob.toLowerCase(),
  }));
}

function pathMatchesAny(path: string, filters: PathFilter[]): boolean {
  const lowerPath = path.toLowerCase();
  for (const filter of filters) {
    if (filter.matcher ? filter.matcher.test(path) : lowerPath.includes(filter.fallback)) {
      return true;
    }
  }

  return false;
}

export function createPathFilterPredicate(
  rootFolderPath: string | null | undefined,
  includeQuery: string,
  excludeQuery: string,
): (path: string) => boolean {
  const includeFilters = compilePathFilters(includeQuery);
  const excludeFilters = compilePathFilters(excludeQuery);

  if (includeFilters.length === 0 && excludeFilters.length === 0) {
    return () => true;
  }

  return (path: string) => {
    const relativePath = getRelativePath(path, rootFolderPath);

    if (includeFilters.length > 0 && !pathMatchesAny(relativePath, includeFilters)) {
      return false;
    }

    if (excludeFilters.length > 0 && pathMatchesAny(relativePath, excludeFilters)) {
      return false;
    }

    return true;
  };
}

export function matchesPathFilters(
  path: string,
  rootFolderPath: string | null | undefined,
  includeQuery: string,
  excludeQuery: string,
): boolean {
  return createPathFilterPredicate(rootFolderPath, includeQuery, excludeQuery)(path);
}
