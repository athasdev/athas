import { useSettingsStore } from "@/features/settings/store";
import Dropdown from "@/ui/dropdown";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";

export const LanguageSettings = () => {
  const settings = useSettingsStore((state) => state.settings);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  // Extract individual settings for easier use
  const {
    defaultLanguage,
    autoDetectLanguage,
    formatOnSave,
    formatter,
    autoCompletion,
    parameterHints,
  } = settings;

  const languageOptions = [
    { value: "auto", label: "Auto Detect" },
    { value: "javascript", label: "JavaScript" },
    { value: "typescript", label: "TypeScript" },
    { value: "python", label: "Python" },
    { value: "rust", label: "Rust" },
    { value: "go", label: "Go" },
    { value: "java", label: "Java" },
    { value: "c", label: "C" },
    { value: "cpp", label: "C++" },
    { value: "html", label: "HTML" },
    { value: "css", label: "CSS" },
    { value: "json", label: "JSON" },
    { value: "markdown", label: "Markdown" },
  ];

  const formatOptions = [
    { value: "prettier", label: "Prettier" },
    { value: "eslint", label: "ESLint" },
    { value: "rustfmt", label: "rustfmt" },
    { value: "gofmt", label: "gofmt" },
  ];

  return (
    <div className="space-y-4">
      <Section title="Language Support">
        <SettingRow
          label="Default Language"
          description="Default syntax highlighting for new files"
        >
          <Dropdown
            value={defaultLanguage}
            options={languageOptions}
            onChange={(value) => updateSetting("defaultLanguage", value)}
            className="w-28"
            size="xs"
          />
        </SettingRow>

        <SettingRow
          label="Auto-detect Language"
          description="Automatically detect file language from extension"
        >
          <Switch
            checked={autoDetectLanguage}
            onChange={(checked) => updateSetting("autoDetectLanguage", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Code Formatting">
        <SettingRow label="Format on Save" description="Automatically format code when saving">
          <Switch
            checked={formatOnSave}
            onChange={(checked) => updateSetting("formatOnSave", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow label="Default Formatter" description="Choose default code formatter">
          <Dropdown
            value={formatter}
            options={formatOptions}
            onChange={(value) => updateSetting("formatter", value)}
            className="w-24"
            size="xs"
          />
        </SettingRow>
      </Section>

      <Section title="IntelliSense">
        <SettingRow label="Auto Completion" description="Show completion suggestions while typing">
          <Switch
            checked={autoCompletion}
            onChange={(checked) => updateSetting("autoCompletion", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow label="Parameter Hints" description="Show function parameter hints">
          <Switch
            checked={parameterHints}
            onChange={(checked) => updateSetting("parameterHints", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
