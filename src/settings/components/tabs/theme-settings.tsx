import { Upload } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/components/ui/button";
import Dropdown from "@/components/ui/dropdown";
import Section, { SettingRow } from "@/components/ui/section";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { ThemeDefinition } from "@/extensions/themes/types";
import { useSettingsStore } from "@/settings/stores/settings-store";

export const ThemeSettings = () => {
  const { settings, updateTheme } = useSettingsStore();
  const [themeOptions, setThemeOptions] = useState<{ value: string; label: string }[]>([]);

  // Load themes from theme registry
  useEffect(() => {
    const loadThemes = () => {
      const registryThemes = themeRegistry.getAllThemes();
      const options = [
        { value: "auto", label: "Auto (System)" },
        ...registryThemes.map((theme: ThemeDefinition) => ({
          value: theme.id,
          label: theme.name,
        })),
      ];
      setThemeOptions(options);
    };

    loadThemes();

    // Listen for theme registry changes
    const unsubscribe = themeRegistry.onRegistryChange(loadThemes);
    return unsubscribe;
  }, []);

  const handleUploadTheme = async () => {
    // Create file input element
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".toml";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const { uploadTheme } = await import("@/utils/theme-upload");
        const result = await uploadTheme(file);
        if (result.success) {
          console.log("Theme uploaded successfully:", result.theme?.name);
        } else {
          console.error("Theme upload failed:", result.error);
        }
      }
    };
    input.click();
  };

  const getThemeDescription = () => {
    if (settings.theme === "auto") {
      return "Automatically switches between light and dark themes based on system preference";
    }
    const currentTheme = themeRegistry.getTheme(settings.theme);
    return currentTheme?.description || "Choose your preferred color theme";
  };

  return (
    <div className="space-y-4">
      <Section title="Appearance">
        <SettingRow label="Theme" description={getThemeDescription()}>
          <div className="flex items-center gap-2">
            <Dropdown
              value={settings.theme}
              options={themeOptions}
              onChange={(value) => updateTheme(value)}
              className="w-40"
              size="xs"
            />
            <Button onClick={handleUploadTheme} variant="ghost" size="xs" className="gap-1 px-2">
              <Upload size={12} />
              Upload
            </Button>
          </div>
        </SettingRow>
      </Section>
    </div>
  );
};
