import { invoke } from "@tauri-apps/api/core";
import { FilePlusIcon, TrashIcon, UploadIcon } from "@/ui/icons";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { useRegisteredIconThemes } from "@/extensions/icon-themes/use-registered-icon-themes";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { useRegisteredThemes } from "@/extensions/themes/use-registered-themes";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getServiceUrls } from "@/config/services";
import { CustomThemeCreatorDialog } from "@/features/settings/components/custom-theme-creator-dialog";
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
import { toast } from "@/ui/toast";
import {
  chooseThemeFile,
  deleteCustomTheme,
  uploadTheme,
} from "@/features/settings/utils/theme-upload";

export const AppearanceSettings = () => {
  const settings = useSettingsStore(
    useShallow((state) => ({
      autoThemeDark: state.settings.autoThemeDark,
      autoThemeLight: state.settings.autoThemeLight,
      compactMenuBar: state.settings.compactMenuBar,
      iconTheme: state.settings.iconTheme,
      nativeMenuBar: state.settings.nativeMenuBar,
      openFoldersInNewWindow: state.settings.openFoldersInNewWindow,
      syncSystemTheme: state.settings.syncSystemTheme,
      theme: state.settings.theme,
      uiFontFamily: state.settings.uiFontFamily,
      uiFontSize: state.settings.uiFontSize,
      windowTransparency: state.settings.windowTransparency,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const registeredThemes = useRegisteredThemes();
  const registeredIconThemes = useRegisteredIconThemes();
  const [isThemeCreatorOpen, setIsThemeCreatorOpen] = useState(false);
  const themeDocsUrl = `${getServiceUrls().docsUrl}/themes`;
  const customThemes = useMemo(
    () =>
      registeredThemes.filter((theme) => themeRegistry.getThemeSource(theme.id)?.kind === "custom"),
    [registeredThemes],
  );

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

  const selectImportedTheme = (themeId: string) => {
    const theme = themeRegistry.getTheme(themeId);
    if (!theme) return;

    if (!settings.syncSystemTheme) {
      void updateSetting("theme", themeId);
      return;
    }

    void updateSetting(theme.isDark ? "autoThemeDark" : "autoThemeLight", themeId);
  };

  const handleUploadTheme = () => {
    chooseThemeFile((file) => {
      void uploadTheme(file).then((result) => {
        if (!result.success || !result.theme) {
          toast.error(
            result.error ?? "Failed to import theme",
            result.details?.slice(0, 4).join("\n"),
          );
          return;
        }

        toast.success(
          result.themes?.length === 1
            ? `Imported ${result.theme.name}`
            : `Imported ${result.themes?.length ?? 0} theme variants`,
        );
        selectImportedTheme(result.theme.id);
      });
    });
  };

  const handleRemoveCustomTheme = async (themeId: string) => {
    try {
      const fallbackUpdates: Promise<void>[] = [];
      if (settings.theme === themeId) {
        fallbackUpdates.push(updateSetting("theme", getDefaultSetting("theme")));
      }
      if (settings.autoThemeLight === themeId) {
        fallbackUpdates.push(updateSetting("autoThemeLight", getDefaultSetting("autoThemeLight")));
      }
      if (settings.autoThemeDark === themeId) {
        fallbackUpdates.push(updateSetting("autoThemeDark", getDefaultSetting("autoThemeDark")));
      }
      await Promise.all(fallbackUpdates);
      await deleteCustomTheme(themeId);
      toast.success("Custom theme removed");
    } catch (error) {
      toast.error(
        "Failed to remove custom theme",
        error instanceof Error ? error.message : String(error),
      );
    }
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
            <Select
              value={settings.theme}
              options={normalizedThemeOptions}
              onChange={(value) => updateSetting("theme", value)}
              className={SETTINGS_CONTROL_WIDTHS.wide}
              size="md"
              variant="default"
              searchable
              searchableTrigger="input"
            />
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
              <Select
                value={settings.autoThemeLight}
                options={lightThemeOptions}
                onChange={(value) => updateSetting("autoThemeLight", value)}
                className={SETTINGS_CONTROL_WIDTHS.wide}
                size="md"
                variant="default"
                searchable
                searchableTrigger="input"
              />
            </SettingRow>

            <SettingRow
              label="Preferred Dark Theme"
              description="Used when Sync With OS is enabled and the system appearance is dark"
              onReset={() => updateSetting("autoThemeDark", getDefaultSetting("autoThemeDark"))}
              canReset={settings.autoThemeDark !== getDefaultSetting("autoThemeDark")}
            >
              <Select
                value={settings.autoThemeDark}
                options={darkThemeOptions}
                onChange={(value) => updateSetting("autoThemeDark", value)}
                className={SETTINGS_CONTROL_WIDTHS.wide}
                size="md"
                variant="default"
                searchable
                searchableTrigger="input"
              />
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
            size="md"
            variant="default"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>

        <SettingRow
          label="Custom Themes"
          description={
            <>
              Import Athas theme JSON or create one from an installed theme.{" "}
              <a
                href={themeDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link hover:underline"
              >
                Format guide
              </a>
            </>
          }
        >
          <div className="flex items-center gap-2">
            <Button type="button" size="xs" onClick={() => setIsThemeCreatorOpen(true)}>
              <FilePlusIcon />
              Create
            </Button>
            <Button type="button" size="xs" onClick={handleUploadTheme}>
              <UploadIcon />
              Import
            </Button>
          </div>
        </SettingRow>

        {customThemes.map((theme) => (
          <SettingRow
            key={theme.id}
            label={theme.name}
            description={`${theme.category} custom theme · ${theme.id}`}
          >
            <Button
              type="button"
              size="icon-xs"
              variant="danger"
              tooltip={`Remove ${theme.name}`}
              onClick={() => void handleRemoveCustomTheme(theme.id)}
            >
              <TrashIcon />
            </Button>
          </SettingRow>
        ))}
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
            size="md"
            aria-label={`UI font size: ${formatUiFontSize(settings.uiFontSize)} pixels`}
          />
        </SettingRow>
      </Section>

      <Section title="Layout">
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
          label="Open Projects In New Window"
          description="Opening another folder uses a separate window when a project is already open"
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

      {isThemeCreatorOpen ? (
        <CustomThemeCreatorDialog
          baseThemeId={settings.theme}
          themes={registeredThemes}
          onClose={() => setIsThemeCreatorOpen(false)}
          onInstalled={selectImportedTheme}
        />
      ) : null}
    </div>
  );
};
