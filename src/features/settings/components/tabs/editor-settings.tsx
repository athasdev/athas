import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import Input from "@/ui/input";
import NumberInput from "@/ui/number-input";
import Section, { SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { FontSelector } from "../font-selector";

export const EditorSettings = () => {
  const { settings, updateSetting } = useSettingsStore();

  return (
    <div className="space-y-4">
      <Section title="Typography">
        <SettingRow
          label="Editor Font Family"
          description="Font family for code editor"
          onReset={() => updateSetting("fontFamily", getDefaultSetting("fontFamily"))}
          canReset={settings.fontFamily !== getDefaultSetting("fontFamily")}
        >
          <FontSelector
            value={settings.fontFamily}
            onChange={(fontFamily) => updateSetting("fontFamily", fontFamily)}
            className="w-48"
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
            className="w-16"
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
            className="w-16"
            size="xs"
          />
        </SettingRow>
      </Section>

      <Section title="Display">
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
      </Section>

      <Section title="Input">
        <SettingRow
          label="Vim Mode"
          description="Enable vim keybindings and commands"
          onReset={() => updateSetting("vimMode", getDefaultSetting("vimMode"))}
          canReset={settings.vimMode !== getDefaultSetting("vimMode")}
        >
          <Switch
            checked={settings.vimMode}
            onChange={(checked) => updateSetting("vimMode", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Tabs">
        <SettingRow
          label="Max Open Tabs"
          description="Maximum number of tabs before oldest closes"
          onReset={() => updateSetting("maxOpenTabs", getDefaultSetting("maxOpenTabs"))}
          canReset={settings.maxOpenTabs !== getDefaultSetting("maxOpenTabs")}
        >
          <NumberInput
            min="1"
            max="50"
            value={settings.maxOpenTabs}
            onChange={(val) => updateSetting("maxOpenTabs", val)}
            className="w-16"
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
      </Section>

      <Section title="Saving">
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
      </Section>

      <Section title="External Editor">
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
            className="w-48"
            size="xs"
            variant="secondary"
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
              className="w-48"
              size="xs"
            />
          </SettingRow>
        )}
      </Section>
    </div>
  );
};
