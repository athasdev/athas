import { useEffect, useState } from "react";
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import {
  getPrimaryFontFamily,
  resolveAvailableFontFamily,
} from "@/features/settings/lib/font-family-resolution";
import { useFontStore } from "@/features/settings/stores/font-store";
import type { FontInfo } from "@/features/settings/stores/types/font";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";

// Bundled fonts that are always available
const BUNDLED_FONTS: FontInfo[] = [
  {
    name: "IBM Plex Sans Variable",
    family: "IBM Plex Sans Variable",
    style: "Regular",
    is_monospace: false,
  },
  {
    name: "JetBrains Mono Variable",
    family: "JetBrains Mono Variable",
    style: "Regular",
    is_monospace: true,
  },
];

interface FontSelectorProps {
  value: string;
  onChange: (fontFamily: string) => void;
  className?: string;
  monospaceOnly?: boolean;
}

export const FontSelector = ({
  value,
  onChange,
  className = "",
  monospaceOnly = false,
}: FontSelectorProps) => {
  const availableFonts = useFontStore.use.availableFonts();
  const monospaceFonts = useFontStore.use.monospaceFonts();
  const isLoading = useFontStore.use.isLoading();
  const error = useFontStore.use.error();
  const { loadAvailableFonts, loadMonospaceFonts, clearError, validateFont } =
    useFontStore.use.actions();

  const [selectedFont, setSelectedFont] = useState(value);
  const [isCustomFontValid, setIsCustomFontValid] = useState(false);

  // Load fonts on mount
  useEffect(() => {
    if (monospaceOnly) {
      loadMonospaceFonts(true); // Force refresh
    } else {
      loadAvailableFonts(true); // Force refresh
    }
  }, [monospaceOnly, loadAvailableFonts, loadMonospaceFonts]);

  // Update selected font when prop changes
  useEffect(() => {
    setSelectedFont(value);
  }, [value]);

  const systemFonts = monospaceOnly ? monospaceFonts : availableFonts;
  const bundledFonts = monospaceOnly ? BUNDLED_FONTS.filter((f) => f.is_monospace) : BUNDLED_FONTS;

  // Combine bundled fonts with system fonts, avoiding duplicates
  const systemFontFamilies = new Set(systemFonts.map((f) => f.family));
  const uniqueBundledFonts = bundledFonts.filter((f) => !systemFontFamilies.has(f.family));
  const fonts = [...uniqueBundledFonts, ...systemFonts];
  const availableFontFamilies = fonts.map((font) => font.family);
  const fallbackFontFamily = monospaceOnly ? DEFAULT_MONO_FONT_FAMILY : DEFAULT_UI_FONT_FAMILY;
  const resolvedValue = resolveAvailableFontFamily(
    value,
    fallbackFontFamily,
    availableFontFamilies,
  );
  const primaryValue = getPrimaryFontFamily(value);

  // Convert fonts to dropdown options
  const fontOptions = fonts.map((font: FontInfo, index) => ({
    value: font.family,
    label: index < uniqueBundledFonts.length ? `${font.family} (bundled)` : font.family,
  }));

  // Add custom font option only for real system fonts that validate successfully.
  const currentFontInList = fontOptions.some((option) => option.value === resolvedValue);
  if (
    !currentFontInList &&
    isCustomFontValid &&
    primaryValue &&
    selectedFont &&
    selectedFont.trim() !== ""
  ) {
    fontOptions.unshift({
      value: resolvedValue,
      label: `${resolvedValue} (custom)`,
    });
  }

  useEffect(() => {
    if (!isLoading && value !== resolvedValue) {
      onChange(resolvedValue);
    }
  }, [isLoading, onChange, resolvedValue, value]);

  useEffect(() => {
    if (!primaryValue || value !== resolvedValue) {
      setIsCustomFontValid(false);
      return;
    }

    if (availableFontFamilies.some((family) => family === resolvedValue)) {
      setIsCustomFontValid(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      const isValid = await validateFont(primaryValue);
      if (!cancelled) {
        setIsCustomFontValid(isValid);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [availableFontFamilies, primaryValue, resolvedValue, validateFont, value]);

  const handleFontChange = (fontFamily: string) => {
    setSelectedFont(fontFamily);
    onChange(fontFamily);
    clearError();
  };

  if (isLoading) {
    return (
      <div className={cn("ui-font ui-text-sm text-text-lighter", className)}>Loading fonts...</div>
    );
  }

  if (error) {
    return (
      <div className={cn("ui-font ui-text-sm text-error", className)}>
        Error loading fonts: {error}
      </div>
    );
  }

  return (
    <Select
      value={resolvedValue}
      options={fontOptions}
      onChange={handleFontChange}
      placeholder="Select font"
      className={className}
      size="xs"
      variant="secondary"
      searchable
      searchableTrigger="input"
    />
  );
};
