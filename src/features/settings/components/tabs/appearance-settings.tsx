import { invoke } from "@tauri-apps/api/core";
import { Minus, Plus, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import type { IconThemeDefinition } from "@/extensions/icon-themes/types";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { ThemeDefinition } from "@/extensions/themes/types";
import {
  formatUiFontSize,
  shiftUiFontSize,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
} from "@/features/settings/lib/ui-font-size";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import Button from "@/ui/button";
import { FontSelector } from "@/ui/font-selector";
import Section, { SettingRow } from "@/ui/section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";

export const AppearanceSettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const [themeOptions, setThemeOptions] = useState<{ value: string; label: string }[]>([]);
  const [iconThemeOptions, setIconThemeOptions] = useState<{ value: string; label: string }[]>([]);

  const sidebarOptions = [
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
  ];

  // Load themes from theme registry
  useEffect(() => {
    const loadThemes = () => {
      const registryThemes = themeRegistry.getAllThemes();
      const options = registryThemes.map((theme: ThemeDefinition) => ({
        value: theme.id,
        label: theme.name,
      }));
      setThemeOptions(options);
    };

    loadThemes();

    const unsubscribe = themeRegistry.onRegistryChange(loadThemes);
    return unsubscribe;
  }, []);

  const normalizedThemeOptions = useMemo(() => {
    if (themeOptions.some((option) => option.value === settings.theme)) {
      return themeOptions;
    }

    const fallbackTheme = themeRegistry.getTheme(settings.theme);
    if (!fallbackTheme) {
      return themeOptions;
    }

    return [{ value: fallbackTheme.id, label: fallbackTheme.name }, ...themeOptions];
  }, [themeOptions, settings.theme]);

  // Load icon themes from icon theme registry
  useEffect(() => {
    const loadIconThemes = () => {
      const registryThemes = iconThemeRegistry.getAllThemes();
      const options = registryThemes.map((theme: IconThemeDefinition) => ({
        value: theme.id,
        label: theme.name,
      }));
      setIconThemeOptions(options);
    };

    loadIconThemes();

    const unsubscribe = iconThemeRegistry.onRegistryChange(loadIconThemes);
    return unsubscribe;
  }, []);

  const normalizedIconThemeOptions = useMemo(() => {
    if (iconThemeOptions.some((option) => option.value === settings.iconTheme)) {
      return iconThemeOptions;
    }

    const fallbackIconTheme = iconThemeRegistry.getTheme(settings.iconTheme);
    if (!fallbackIconTheme) {
      return iconThemeOptions;
    }

    return [{ value: fallbackIconTheme.id, label: fallbackIconTheme.name }, ...iconThemeOptions];
  }, [iconThemeOptions, settings.iconTheme]);

  const handleUploadTheme = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const { uploadTheme } = await import("@/features/settings/utils/theme-upload");
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

  const handleIconThemeChange = (themeId: string) => {
    updateSetting("iconTheme", themeId);
  };

  const canDecreaseUiFontSize = settings.uiFontSize > UI_FONT_SIZE_MIN;
  const canIncreaseUiFontSize = settings.uiFontSize < UI_FONT_SIZE_MAX;

  const handleDecreaseUiFontSize = () => {
    updateSetting("uiFontSize", shiftUiFontSize(settings.uiFontSize, -1));
  };

  const handleIncreaseUiFontSize = () => {
    updateSetting("uiFontSize", shiftUiFontSize(settings.uiFontSize, 1));
  };

  const getThemeDescription = () => {
    const currentTheme = themeRegistry.getTheme(settings.theme);
    return currentTheme?.description || "Choose your preferred color theme";
  };

  return (
    <div className="space-y-4">
      <Section title="Theme">
        <SettingRow
          label="Color Theme"
          description={getThemeDescription()}
          onReset={() => updateSetting("theme", getDefaultSetting("theme"))}
          canReset={settings.theme !== getDefaultSetting("theme")}
        >
          <div className="flex items-center gap-2">
            <Select
              value={settings.theme}
              options={normalizedThemeOptions}
              onChange={(value) => updateSetting("theme", value)}
              className="w-40"
              size="xs"
              searchable
            />
            <Button onClick={handleUploadTheme} variant="ghost" size="xs" className="gap-1 px-2">
              <Upload size={12} />
              Upload
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label="Icon Theme"
          description="Icons displayed in the file tree and tabs"
          onReset={() => updateSetting("iconTheme", getDefaultSetting("iconTheme"))}
          canReset={settings.iconTheme !== getDefaultSetting("iconTheme")}
        >
          <Select
            value={settings.iconTheme}
            options={normalizedIconThemeOptions}
            onChange={handleIconThemeChange}
            className="w-40"
            size="xs"
            searchable
          />
        </SettingRow>
      </Section>

      <Section title="Typography">
        <SettingRow
          label="UI Font Family"
          description="Font family for UI elements (file tree, markdown, etc.)"
          onReset={() => updateSetting("uiFontFamily", getDefaultSetting("uiFontFamily"))}
          canReset={settings.uiFontFamily !== getDefaultSetting("uiFontFamily")}
        >
          <FontSelector
            value={settings.uiFontFamily}
            onChange={(fontFamily) => updateSetting("uiFontFamily", fontFamily)}
            className="w-48"
            monospaceOnly={false}
          />
        </SettingRow>

        <SettingRow
          label="UI Font Size"
          description="Adjust UI text and icon scale in 0.5px steps"
          onReset={() => updateSetting("uiFontSize", getDefaultSetting("uiFontSize"))}
          canReset={settings.uiFontSize !== getDefaultSetting("uiFontSize")}
        >
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleDecreaseUiFontSize}
              disabled={!canDecreaseUiFontSize}
              aria-label="Decrease UI font size"
              className="px-1.5"
            >
              <Minus size="var(--app-ui-icon-size-sm)" />
            </Button>

            <div className="ui-font min-w-[52px] text-center text-text text-xs tabular-nums">
              {formatUiFontSize(settings.uiFontSize)}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleIncreaseUiFontSize}
              disabled={!canIncreaseUiFontSize}
              aria-label="Increase UI font size"
              className="px-1.5"
            >
              <Plus size="var(--app-ui-icon-size-sm)" />
            </Button>
          </div>
        </SettingRow>
      </Section>

      <Section title="Layout">
        <SettingRow
          label="Sidebar Position"
          description="Choose where to position the sidebar"
          onReset={() => updateSetting("sidebarPosition", getDefaultSetting("sidebarPosition"))}
          canReset={settings.sidebarPosition !== getDefaultSetting("sidebarPosition")}
        >
          <Select
            value={settings.sidebarPosition}
            options={sidebarOptions}
            onChange={(value) => updateSetting("sidebarPosition", value as "left" | "right")}
            className="w-20"
            size="xs"
          />
        </SettingRow>

        <SettingRow
          label="Native Menu Bar"
          description="Use the native menu bar or a custom UI menu bar"
          onReset={() => updateSetting("nativeMenuBar", getDefaultSetting("nativeMenuBar"))}
          canReset={settings.nativeMenuBar !== getDefaultSetting("nativeMenuBar")}
        >
          <Switch
            checked={settings.nativeMenuBar}
            onChange={(checked) => {
              updateSetting("nativeMenuBar", checked);
              invoke("toggle_menu_bar", { toggle: checked });
            }}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Compact Menu Bar"
          description="Requires UI menu bar; compact hamburger or full UI menu"
          onReset={() => updateSetting("compactMenuBar", getDefaultSetting("compactMenuBar"))}
          canReset={settings.compactMenuBar !== getDefaultSetting("compactMenuBar")}
        >
          <Switch
            checked={settings.compactMenuBar}
            disabled={settings.nativeMenuBar}
            onChange={(checked) => updateSetting("compactMenuBar", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Quick Open Preview"
          description="Show right-side file preview in quick open and global search"
          onReset={() => updateSetting("quickOpenPreview", getDefaultSetting("quickOpenPreview"))}
          canReset={settings.quickOpenPreview !== getDefaultSetting("quickOpenPreview")}
        >
          <Switch
            checked={settings.quickOpenPreview}
            onChange={(checked) => updateSetting("quickOpenPreview", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
