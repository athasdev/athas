import { useSettingsStore } from "@/features/settings/store";
import Dropdown from "@/ui/dropdown";
import { FontSelector } from "@/ui/font-selector";
import Input from "@/ui/input";
import NumberInput from "@/ui/number-input";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";

export const EditorSettings = () => {
  const { settings, updateSetting } = useSettingsStore();

  return (
    <div className="space-y-4">
      <Section title="Typography">
        <SettingRow
          label="UI Font Family"
          description="Font family for UI elements (file tree, markdown, etc.)"
        >
          <FontSelector
            value={settings.uiFontFamily}
            onChange={(fontFamily) => updateSetting("uiFontFamily", fontFamily)}
            className="w-48"
            monospaceOnly={false}
          />
        </SettingRow>

        <SettingRow label="Editor Font Family" description="Font family for code editor">
          <FontSelector
            value={settings.fontFamily}
            onChange={(fontFamily) => updateSetting("fontFamily", fontFamily)}
            className="w-48"
            monospaceOnly={true}
          />
        </SettingRow>

        <SettingRow label="Font Size" description="Editor font size in pixels">
          <NumberInput
            min="8"
            max="32"
            value={settings.fontSize}
            onChange={(val) => updateSetting("fontSize", val)}
            className="w-16"
            size="xs"
          />
        </SettingRow>

        <SettingRow label="Tab Size" description="Number of spaces per tab">
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
        <SettingRow label="Word Wrap" description="Wrap lines that exceed viewport width">
          <Switch
            checked={settings.wordWrap}
            onChange={(checked) => updateSetting("wordWrap", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow label="Line Numbers" description="Show line numbers in the editor">
          <Switch
            checked={settings.lineNumbers}
            onChange={(checked) => updateSetting("lineNumbers", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Relative Line Numbers"
          description="Show relative numbers when Vim mode is active"
        >
          <Switch
            checked={settings.vimRelativeLineNumbers}
            onChange={(checked) => updateSetting("vimRelativeLineNumbers", checked)}
            size="sm"
            disabled={!settings.lineNumbers}
          />
        </SettingRow>
      </Section>

      <Section title="Input">
        <SettingRow label="Vim Mode" description="Enable vim keybindings and commands">
          <Switch
            checked={settings.vimMode}
            onChange={(checked) => updateSetting("vimMode", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="External Editor">
        <SettingRow
          label="Default Editor"
          description="Open files in an external terminal editor instead of the built-in editor"
        >
          <Dropdown
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
            size="sm"
          />
        </SettingRow>

        {settings.externalEditor === "custom" && (
          <SettingRow
            label="Custom Command"
            description="Command to run (use $FILE for the file path, e.g., 'micro $FILE')"
          >
            <Input
              type="text"
              value={settings.customEditorCommand}
              onChange={(e) => updateSetting("customEditorCommand", e.target.value)}
              placeholder="micro $FILE"
              className="w-48"
              size="sm"
            />
          </SettingRow>
        )}
      </Section>
    </div>
  );
};
