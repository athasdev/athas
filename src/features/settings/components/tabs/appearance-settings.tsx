import { invoke } from "@tauri-apps/api/core";
import { UploadIcon as Upload } from "@phosphor-icons/react";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { useRegisteredIconThemes } from "@/extensions/icon-themes/use-registered-icon-themes";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { useRegisteredThemes } from "@/extensions/themes/use-registered-themes";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  formatUiFontSize,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  UI_FONT_SIZE_STEP,
} from "@/features/settings/lib/ui-font-size";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import NumberInput from "@/ui/number-input";
import Section, { SETTINGS_CONTROL_WIDTHS, SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { cn } from "@/utils/cn";
import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/utils/platform";
import { FontSelector } from "../font-selector";

export const AppearanceSettings = () => {
  const settings = useSettingsStore(
    useShallow((state) => ({
      autoThemeDark: state.settings.autoThemeDark,
      autoThemeLight: state.settings.autoThemeLight,
      compactMenuBar: state.settings.compactMenuBar,
      iconTheme: state.settings.iconTheme,
      nativeMenuBar: state.settings.nativeMenuBar,
      openFoldersInNewWindow: state.settings.openFoldersInNewWindow,
      sidebarPosition: state.settings.sidebarPosition,
      sidebarTabsPosition: state.settings.sidebarTabsPosition,
      syncSystemTheme: state.settings.syncSystemTheme,
      theme: state.settings.theme,
      titleBarProjectMode: state.settings.titleBarProjectMode,
      uiFontFamily: state.settings.uiFontFamily,
      uiFontSize: state.settings.uiFontSize,
      windowTransparency: state.settings.windowTransparency,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const registeredThemes = useRegisteredThemes();
  const registeredIconThemes = useRegisteredIconThemes();

  const sidebarOptions = [
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
  ];
  const titleBarProjectModeOptions = [
    { value: "tabs", label: "Tabs" },
    { value: "window", label: "Window" },
  ];
  const sidebarTabsPositionOptions = [
    { value: "top", label: "Top" },
    { value: "left", label: "Side" },
  ];

  const themeOptions = useMemo(
    () =>
      registeredThemes.map((theme) => ({
        value: theme.id,
        label: theme.name,
      })),
    [registeredThemes],
  );

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

  const lightThemeOptions = useMemo(
    () =>
      normalizedThemeOptions.filter((option) => {
        const theme = themeRegistry.getTheme(option.value);
        return theme ? !theme.isDark : true;
      }),
    [normalizedThemeOptions],
  );

  const darkThemeOptions = useMemo(
    () =>
      normalizedThemeOptions.filter((option) => {
        const theme = themeRegistry.getTheme(option.value);
        return theme ? !!theme.isDark : true;
      }),
    [normalizedThemeOptions],
  );

  const iconThemeOptions = useMemo(
    () =>
      registeredIconThemes.map((theme) => ({
        value: theme.id,
        label: theme.name,
      })),
    [registeredIconThemes],
  );

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

  return (
    <div className="space-y-4">
      <Section title="Theme">
        <SettingRow
          label="Sync With OS"
          description="Automatically switch between your preferred light and dark themes"
          onReset={() => updateSetting("syncSystemTheme", getDefaultSetting("syncSystemTheme"))}
          canReset={settings.syncSystemTheme !== getDefaultSetting("syncSystemTheme")}
        >
          <Switch
            checked={settings.syncSystemTheme}
            onChange={(checked) => updateSetting("syncSystemTheme", checked)}
            size="sm"
          />
        </SettingRow>

        {!settings.syncSystemTheme ? (
          <SettingRow
            label="Color Theme"
            description="Choose your preferred color theme"
            onReset={() => updateSetting("theme", getDefaultSetting("theme"))}
            canReset={settings.theme !== getDefaultSetting("theme")}
          >
            <div className="flex items-center gap-2">
              <Select
                value={settings.theme}
                options={normalizedThemeOptions}
                onChange={(value) => updateSetting("theme", value)}
                className={SETTINGS_CONTROL_WIDTHS.wide}
                size="xs"
                variant="default"
                searchable
                searchableTrigger="input"
              />
              <Button
                type="button"
                onClick={handleUploadTheme}
                variant="default"
                tooltip="Upload theme"
                aria-label="Upload theme"
                compact
              >
                <Upload />
              </Button>
            </div>
          </SettingRow>
        ) : null}

        {settings.syncSystemTheme ? (
          <>
            <SettingRow
              label="Preferred Light Theme"
              description="Used when Sync With OS is enabled and the system appearance is light"
              onReset={() => updateSetting("autoThemeLight", getDefaultSetting("autoThemeLight"))}
              canReset={settings.autoThemeLight !== getDefaultSetting("autoThemeLight")}
            >
              <div className="flex items-center gap-2">
                <Select
                  value={settings.autoThemeLight}
                  options={lightThemeOptions}
                  onChange={(value) => updateSetting("autoThemeLight", value)}
                  className={SETTINGS_CONTROL_WIDTHS.wide}
                  size="xs"
                  variant="default"
                  searchable
                  searchableTrigger="input"
                />
                <Button
                  type="button"
                  onClick={handleUploadTheme}
                  variant="default"
                  tooltip="Upload theme"
                  aria-label="Upload theme"
                  compact
                >
                  <Upload />
                </Button>
              </div>
            </SettingRow>

            <SettingRow
              label="Preferred Dark Theme"
              description="Used when Sync With OS is enabled and the system appearance is dark"
              onReset={() => updateSetting("autoThemeDark", getDefaultSetting("autoThemeDark"))}
              canReset={settings.autoThemeDark !== getDefaultSetting("autoThemeDark")}
            >
              <div className="flex items-center gap-2">
                <Select
                  value={settings.autoThemeDark}
                  options={darkThemeOptions}
                  onChange={(value) => updateSetting("autoThemeDark", value)}
                  className={SETTINGS_CONTROL_WIDTHS.wide}
                  size="xs"
                  variant="default"
                  searchable
                  searchableTrigger="input"
                />
                <Button
                  type="button"
                  onClick={handleUploadTheme}
                  variant="default"
                  tooltip="Upload theme"
                  aria-label="Upload theme"
                  compact
                >
                  <Upload />
                </Button>
              </div>
            </SettingRow>
          </>
        ) : null}

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
            className={SETTINGS_CONTROL_WIDTHS.wide}
            size="xs"
            variant="default"
            searchable
            searchableTrigger="input"
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
            className={SETTINGS_CONTROL_WIDTHS.text}
            monospaceOnly={false}
          />
        </SettingRow>

        <SettingRow
          label="UI Font Size"
          description="Adjust UI text and icon scale in 0.5px steps"
          onReset={() => updateSetting("uiFontSize", getDefaultSetting("uiFontSize"))}
          canReset={settings.uiFontSize !== getDefaultSetting("uiFontSize")}
        >
          <NumberInput
            min={String(UI_FONT_SIZE_MIN)}
            max={String(UI_FONT_SIZE_MAX)}
            step={String(UI_FONT_SIZE_STEP)}
            value={settings.uiFontSize}
            onChange={(value) => updateSetting("uiFontSize", value)}
            className={cn(SETTINGS_CONTROL_WIDTHS.number, "tabular-nums")}
            size="xs"
            aria-label={`UI font size: ${formatUiFontSize(settings.uiFontSize)} pixels`}
          />
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
            className={SETTINGS_CONTROL_WIDTHS.compact}
            size="xs"
            variant="default"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>

        <SettingRow
          label="Sidebar Tabs"
          description="Show sidebar activity tabs across the top or beside the sidebar"
          onReset={() =>
            updateSetting("sidebarTabsPosition", getDefaultSetting("sidebarTabsPosition"))
          }
          canReset={settings.sidebarTabsPosition !== getDefaultSetting("sidebarTabsPosition")}
        >
          <Select
            value={settings.sidebarTabsPosition}
            options={sidebarTabsPositionOptions}
            onChange={(value) => updateSetting("sidebarTabsPosition", value as "top" | "left")}
            className={SETTINGS_CONTROL_WIDTHS.compact}
            size="xs"
            variant="default"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>

        {!IS_MAC && !IS_WINDOWS && !IS_LINUX && (
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
        )}

        {!IS_MAC && (
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
        )}

        <SettingRow
          label="Window Transparency"
          description="Use translucent app chrome and transparent native windows where supported"
          onReset={() =>
            updateSetting("windowTransparency", getDefaultSetting("windowTransparency"))
          }
          canReset={settings.windowTransparency !== getDefaultSetting("windowTransparency")}
        >
          <Switch
            checked={settings.windowTransparency}
            onChange={(checked) => updateSetting("windowTransparency", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Title Bar Project Mode"
          description="Show project tabs or a single window-style title in the custom title bar"
          onReset={() =>
            updateSetting("titleBarProjectMode", getDefaultSetting("titleBarProjectMode"))
          }
          canReset={settings.titleBarProjectMode !== getDefaultSetting("titleBarProjectMode")}
        >
          <Select
            value={settings.titleBarProjectMode}
            options={titleBarProjectModeOptions}
            onChange={(value) => updateSetting("titleBarProjectMode", value as "tabs" | "window")}
            className={SETTINGS_CONTROL_WIDTHS.default}
            size="xs"
            variant="default"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>

        <SettingRow
          label="Open Projects In New Window"
          description="In window title mode, opening another folder uses a separate window when a project is already open"
          onReset={() =>
            updateSetting("openFoldersInNewWindow", getDefaultSetting("openFoldersInNewWindow"))
          }
          canReset={settings.openFoldersInNewWindow !== getDefaultSetting("openFoldersInNewWindow")}
        >
          <Switch
            checked={settings.openFoldersInNewWindow}
            onChange={(checked) => updateSetting("openFoldersInNewWindow", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
