function wildcardToRegExp(pattern: string): RegExp {
  return new RegExp(
    `^${pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .split("*")
      .join(".*")}$`,
  );
}

export function isExtensionNetworkRequestAllowed(url: string, patterns: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    return false;
  }

  const origin = parsed.origin;
  return patterns.some((pattern) => {
    if (!pattern.startsWith("http://") && !pattern.startsWith("https://")) {
      return false;
    }
    return wildcardToRegExp(pattern.replace(/\/$/, "")).test(origin);
  });
}
