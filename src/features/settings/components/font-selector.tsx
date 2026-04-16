import { useEffect, useState } from "react";
import { useFontStore } from "@/features/settings/stores/font-store";
import type { FontInfo } from "@/features/settings/stores/types/font";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";

// Bundled fonts that are always available
const BUNDLED_FONTS: FontInfo[] = [
  { name: "Geist Variable", family: "Geist Variable", style: "Regular", is_monospace: false },
  {
    name: "Geist Mono Variable",
    family: "Geist Mono Variable",
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
  const { loadAvailableFonts, loadMonospaceFonts, clearError } = useFontStore.use.actions();

  const [selectedFont, setSelectedFont] = useState(value);

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

  // Convert fonts to dropdown options
  const fontOptions = fonts.map((font: FontInfo, index) => ({
    value: font.family,
    label: index < uniqueBundledFonts.length ? `${font.family} (bundled)` : font.family,
  }));

  // Add custom font option if current value is not in the list
  const currentFontInList = fontOptions.some((option) => option.value === selectedFont);
  if (!currentFontInList && selectedFont && selectedFont.trim() !== "") {
    fontOptions.unshift({
      value: selectedFont,
      label: `${selectedFont} (custom)`,
    });
  }

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
      value={selectedFont}
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
