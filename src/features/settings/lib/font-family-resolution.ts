import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";

const LEGACY_FONT_MIGRATIONS: Record<string, string> = {
  geist: DEFAULT_UI_FONT_FAMILY,
  "geist sans": DEFAULT_UI_FONT_FAMILY,
  "geist mono": DEFAULT_MONO_FONT_FAMILY,
};

export function getPrimaryFontFamily(fontFamily: string): string {
  return fontFamily
    .split(",")[0]
    ?.trim()
    .replace(/^['"]+|['"]+$/g, "");
}

export function normalizeConfiguredFontFamily(fontFamily: string, fallback: string): string {
  const primaryFontFamily = getPrimaryFontFamily(fontFamily);
  const normalizedPrimaryFamily = primaryFontFamily.toLowerCase();

  if (!normalizedPrimaryFamily) {
    return fallback;
  }

  return LEGACY_FONT_MIGRATIONS[normalizedPrimaryFamily] ?? fontFamily;
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
