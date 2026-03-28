import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import Section, { SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";

export const LanguageSettings = () => {
  const settings = useSettingsStore((state) => state.settings);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  // Extract individual settings for easier use
  const {
    defaultLanguage,
    autoDetectLanguage,
    formatOnSave,
    lintOnSave,
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
          onReset={() => updateSetting("defaultLanguage", getDefaultSetting("defaultLanguage"))}
          canReset={defaultLanguage !== getDefaultSetting("defaultLanguage")}
        >
          <Select
            value={defaultLanguage}
            options={languageOptions}
            onChange={(value) => updateSetting("defaultLanguage", value)}
            className="w-28"
            size="xs"
            variant="secondary"
          />
        </SettingRow>

        <SettingRow
          label="Auto-detect Language"
          description="Automatically detect file language from extension"
          onReset={() =>
            updateSetting("autoDetectLanguage", getDefaultSetting("autoDetectLanguage"))
          }
          canReset={autoDetectLanguage !== getDefaultSetting("autoDetectLanguage")}
        >
          <Switch
            checked={autoDetectLanguage}
            onChange={(checked) => updateSetting("autoDetectLanguage", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Code Formatting">
        <SettingRow
          label="Format on Save"
          description="Automatically format code when saving"
          onReset={() => updateSetting("formatOnSave", getDefaultSetting("formatOnSave"))}
          canReset={formatOnSave !== getDefaultSetting("formatOnSave")}
        >
          <Switch
            checked={formatOnSave}
            onChange={(checked) => updateSetting("formatOnSave", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Lint on Save"
          description="Run linter when saving files"
          onReset={() => updateSetting("lintOnSave", getDefaultSetting("lintOnSave"))}
          canReset={lintOnSave !== getDefaultSetting("lintOnSave")}
        >
          <Switch
            checked={lintOnSave}
            onChange={(checked) => updateSetting("lintOnSave", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Default Formatter"
          description="Choose default code formatter"
          onReset={() => updateSetting("formatter", getDefaultSetting("formatter"))}
          canReset={formatter !== getDefaultSetting("formatter")}
        >
          <Select
            value={formatter}
            options={formatOptions}
            onChange={(value) => updateSetting("formatter", value)}
            className="w-24"
            size="xs"
            variant="secondary"
          />
        </SettingRow>
      </Section>

      <Section title="IntelliSense">
        <SettingRow
          label="Auto Completion"
          description="Show completion suggestions while typing"
          onReset={() => updateSetting("autoCompletion", getDefaultSetting("autoCompletion"))}
          canReset={autoCompletion !== getDefaultSetting("autoCompletion")}
        >
          <Switch
            checked={autoCompletion}
            onChange={(checked) => updateSetting("autoCompletion", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Parameter Hints"
          description="Show function parameter hints"
          onReset={() => updateSetting("parameterHints", getDefaultSetting("parameterHints"))}
          canReset={parameterHints !== getDefaultSetting("parameterHints")}
        >
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
