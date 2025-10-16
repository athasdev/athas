import { useEffect, useState } from "react";
import Dropdown from "@/components/ui/dropdown";
import { useFontStore } from "@/stores/font-store";
import type { FontInfo } from "@/types/font";

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
    console.log("FontSelector mounting, monospaceOnly:", monospaceOnly);
    console.log("Available fonts:", availableFonts.length);
    console.log("Monospace fonts:", monospaceFonts.length);

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

  const fonts = monospaceOnly ? monospaceFonts : availableFonts;

  // Convert fonts to dropdown options
  const fontOptions = fonts.map((font: FontInfo) => ({
    value: font.family,
    label: font.family,
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
    return <div className={`text-text-lighter text-xs ${className}`}>Loading fonts...</div>;
  }

  if (error) {
    return <div className={`text-red-400 text-xs ${className}`}>Error loading fonts: {error}</div>;
  }

  return (
    <Dropdown
      value={selectedFont}
      options={fontOptions}
      onChange={handleFontChange}
      placeholder="Select font"
      className={className}
      size="xs"
      searchable={true}
    />
  );
};
