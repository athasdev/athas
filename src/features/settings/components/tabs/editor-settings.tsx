import { useMemo } from "react";
import { getAllLanguages } from "@/features/editor/utils/language-id";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import Input from "@/ui/input";
import NumberInput from "@/ui/number-input";
import Section, { SETTINGS_CONTROL_WIDTHS, SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { FontSelector } from "../font-selector";

export const EditorSettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const languageOptions = useMemo(
    () => [
      { value: "auto", label: "Auto Detect" },
      ...getAllLanguages().map((language) => ({
        value: language.id,
        label: language.displayName,
      })),
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <Section title="Editor">
        <SettingRow
          label="Editor Font Family"
          description="Font family for code editor"
          onReset={() => updateSetting("fontFamily", getDefaultSetting("fontFamily"))}
          canReset={settings.fontFamily !== getDefaultSetting("fontFamily")}
        >
          <FontSelector
            value={settings.fontFamily}
            onChange={(fontFamily) => updateSetting("fontFamily", fontFamily)}
            className={SETTINGS_CONTROL_WIDTHS.text}
            monospaceOnly={true}
          />
        </SettingRow>

        <SettingRow
          label="Font Size"
          description="Editor font size in pixels"
          onReset={() => updateSetting("fontSize", getDefaultSetting("fontSize"))}
          canReset={settings.fontSize !== getDefaultSetting("fontSize")}
        >
          <NumberInput
            min="8"
            max="32"
            value={settings.fontSize}
            onChange={(val) => updateSetting("fontSize", val)}
            className={SETTINGS_CONTROL_WIDTHS.numberCompact}
            size="xs"
          />
        </SettingRow>

        <SettingRow
          label="Line Height"
          description="Editor line height multiplier"
          onReset={() => updateSetting("editorLineHeight", getDefaultSetting("editorLineHeight"))}
          canReset={settings.editorLineHeight !== getDefaultSetting("editorLineHeight")}
        >
          <NumberInput
            min="1"
            max="2"
            step={0.1}
            value={settings.editorLineHeight}
            onChange={(val) => updateSetting("editorLineHeight", val)}
            className={SETTINGS_CONTROL_WIDTHS.numberCompact}
            size="xs"
          />
        </SettingRow>

        <SettingRow
          label="Tab Size"
          description="Number of spaces per tab"
          onReset={() => updateSetting("tabSize", getDefaultSetting("tabSize"))}
          canReset={settings.tabSize !== getDefaultSetting("tabSize")}
        >
          <NumberInput
            min="1"
            max="8"
            value={settings.tabSize}
            onChange={(val) => updateSetting("tabSize", val)}
            className={SETTINGS_CONTROL_WIDTHS.numberCompact}
            size="xs"
          />
        </SettingRow>
        <SettingRow
          label="Word Wrap"
          description="Wrap lines that exceed viewport width"
          onReset={() => updateSetting("wordWrap", getDefaultSetting("wordWrap"))}
          canReset={settings.wordWrap !== getDefaultSetting("wordWrap")}
        >
          <Switch
            checked={settings.wordWrap}
            onChange={(checked) => updateSetting("wordWrap", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Line Numbers"
          description="Show line numbers in the editor"
          onReset={() => updateSetting("lineNumbers", getDefaultSetting("lineNumbers"))}
          canReset={settings.lineNumbers !== getDefaultSetting("lineNumbers")}
        >
          <Switch
            checked={settings.lineNumbers}
            onChange={(checked) => updateSetting("lineNumbers", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Relative Line Numbers"
          description="Show relative numbers when Vim mode is active"
          onReset={() =>
            updateSetting("vimRelativeLineNumbers", getDefaultSetting("vimRelativeLineNumbers"))
          }
          canReset={settings.vimRelativeLineNumbers !== getDefaultSetting("vimRelativeLineNumbers")}
        >
          <Switch
            checked={settings.vimRelativeLineNumbers}
            onChange={(checked) => updateSetting("vimRelativeLineNumbers", checked)}
            size="sm"
            disabled={!settings.lineNumbers}
          />
        </SettingRow>

        <SettingRow
          label="Show Minimap"
          description="Show a minimap overview on the right side of the editor"
          onReset={() => updateSetting("showMinimap", getDefaultSetting("showMinimap"))}
          canReset={settings.showMinimap !== getDefaultSetting("showMinimap")}
        >
          <Switch
            checked={settings.showMinimap}
            onChange={(checked) => updateSetting("showMinimap", checked)}
            size="sm"
          />
        </SettingRow>
        <SettingRow
          label="Max Open Tabs"
          description="Maximum number of tabs before oldest closes"
          onReset={() => updateSetting("maxOpenTabs", getDefaultSetting("maxOpenTabs"))}
          canReset={settings.maxOpenTabs !== getDefaultSetting("maxOpenTabs")}
        >
          <NumberInput
            min="1"
            max="100"
            value={settings.maxOpenTabs}
            onChange={(val) => updateSetting("maxOpenTabs", val)}
            className={SETTINGS_CONTROL_WIDTHS.numberCompact}
            size="xs"
          />
        </SettingRow>

        <SettingRow
          label="Buffer Carousel"
          description="Show open buffers as a horizontally scrollable carousel in the main view"
          onReset={() =>
            updateSetting("horizontalTabScroll", getDefaultSetting("horizontalTabScroll"))
          }
          canReset={settings.horizontalTabScroll !== getDefaultSetting("horizontalTabScroll")}
        >
          <Switch
            checked={settings.horizontalTabScroll}
            onChange={(checked) => updateSetting("horizontalTabScroll", checked)}
            size="sm"
          />
        </SettingRow>
        <SettingRow
          label="Auto Save"
          description="Automatically save files when editing"
          onReset={() => updateSetting("autoSave", getDefaultSetting("autoSave"))}
          canReset={settings.autoSave !== getDefaultSetting("autoSave")}
        >
          <Switch
            checked={settings.autoSave}
            onChange={(checked) => updateSetting("autoSave", checked)}
            size="sm"
          />
        </SettingRow>
        <SettingRow
          label="Default Language"
          description="Default syntax highlighting for new files"
          onReset={() => updateSetting("defaultLanguage", getDefaultSetting("defaultLanguage"))}
          canReset={settings.defaultLanguage !== getDefaultSetting("defaultLanguage")}
        >
          <Select
            value={settings.defaultLanguage}
            options={languageOptions}
            onChange={(value) => updateSetting("defaultLanguage", value)}
            className={SETTINGS_CONTROL_WIDTHS.default}
            size="xs"
            variant="secondary"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>

        <SettingRow
          label="Auto-detect Language"
          description="Automatically detect file language from extension"
          onReset={() =>
            updateSetting("autoDetectLanguage", getDefaultSetting("autoDetectLanguage"))
          }
          canReset={settings.autoDetectLanguage !== getDefaultSetting("autoDetectLanguage")}
        >
          <Switch
            checked={settings.autoDetectLanguage}
            onChange={(checked) => updateSetting("autoDetectLanguage", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Format on Save"
          description="Automatically format code when saving"
          onReset={() => updateSetting("formatOnSave", getDefaultSetting("formatOnSave"))}
          canReset={settings.formatOnSave !== getDefaultSetting("formatOnSave")}
        >
          <Switch
            checked={settings.formatOnSave}
            onChange={(checked) => updateSetting("formatOnSave", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Lint on Save"
          description="Run linter when saving files"
          onReset={() => updateSetting("lintOnSave", getDefaultSetting("lintOnSave"))}
          canReset={settings.lintOnSave !== getDefaultSetting("lintOnSave")}
        >
          <Switch
            checked={settings.lintOnSave}
            onChange={(checked) => updateSetting("lintOnSave", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Auto Completion"
          description="Show completion suggestions while typing"
          onReset={() => updateSetting("autoCompletion", getDefaultSetting("autoCompletion"))}
          canReset={settings.autoCompletion !== getDefaultSetting("autoCompletion")}
        >
          <Switch
            checked={settings.autoCompletion}
            onChange={(checked) => updateSetting("autoCompletion", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Parameter Hints"
          description="Show function parameter hints"
          onReset={() => updateSetting("parameterHints", getDefaultSetting("parameterHints"))}
          canReset={settings.parameterHints !== getDefaultSetting("parameterHints")}
        >
          <Switch
            checked={settings.parameterHints}
            onChange={(checked) => updateSetting("parameterHints", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Default Editor"
          description="Open files in an external terminal editor instead of the built-in editor"
          onReset={() => updateSetting("externalEditor", getDefaultSetting("externalEditor"))}
          canReset={settings.externalEditor !== getDefaultSetting("externalEditor")}
        >
          <Select
            value={settings.externalEditor}
            options={[
              { value: "none", label: "None (Use Built-in)" },
              { value: "nvim", label: "Neovim" },
              { value: "helix", label: "Helix" },
              { value: "vim", label: "Vim" },
              { value: "nano", label: "Nano" },
              { value: "emacs", label: "Emacs" },
              { value: "custom", label: "Custom Command" },
            ]}
            onChange={(value) =>
              updateSetting(
                "externalEditor",
                value as "none" | "nvim" | "helix" | "vim" | "nano" | "emacs" | "custom",
              )
            }
            className={SETTINGS_CONTROL_WIDTHS.text}
            size="xs"
            variant="secondary"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>

        {settings.externalEditor === "custom" && (
          <SettingRow
            label="Custom Command"
            description="Command to run (use $FILE for the file path, e.g., 'micro $FILE')"
            onReset={() =>
              updateSetting("customEditorCommand", getDefaultSetting("customEditorCommand"))
            }
            canReset={settings.customEditorCommand !== getDefaultSetting("customEditorCommand")}
          >
            <Input
              type="text"
              value={settings.customEditorCommand}
              onChange={(e) => updateSetting("customEditorCommand", e.target.value)}
              placeholder="micro $FILE"
              className={SETTINGS_CONTROL_WIDTHS.text}
              size="xs"
            />
          </SettingRow>
        )}
      </Section>
    </div>
  );
};
