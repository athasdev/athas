export function getPrimaryFontFamily(fontFamily: string): string {
  return fontFamily
    .split(",")[0]
    ?.trim()
    .replace(/^['"]+|['"]+$/g, "");
}

export function normalizeConfiguredFontFamily(fontFamily: string, fallback: string): string {
  const primaryFontFamily = getPrimaryFontFamily(fontFamily);

  if (!primaryFontFamily) {
    return fallback;
  }

  return fontFamily;
}

export function buildFontFamilyStack(primary: string, fallback: string): string {
  const trimmed = primary.trim();
  if (!trimmed) return fallback;
  if (trimmed.includes(",")) return trimmed;

  const normalized = trimmed.replace(/^(['"])(.*)\1$/, "$2");
  return `"${normalized}", ${fallback}`;
}

export function resolveAvailableFontFamily(
  fontFamily: string,
  fallback: string,
  availableFonts: Iterable<string>,
  alwaysAvailableFonts: Iterable<string> = [],
): string {
  const normalizedFontFamily = normalizeConfiguredFontFamily(fontFamily, fallback);
  const primaryFontFamily = getPrimaryFontFamily(normalizedFontFamily);

  if (!primaryFontFamily) {
    return fallback;
  }

  const available = new Set(
    [...availableFonts, ...alwaysAvailableFonts].map((family) => family.trim().toLowerCase()),
  );

  if (available.has(primaryFontFamily.toLowerCase())) {
    return normalizedFontFamily;
  }

  return fallback;
}
