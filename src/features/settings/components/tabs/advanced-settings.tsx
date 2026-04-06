import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/store";
import { Button } from "@/ui/button";
import Switch from "@/ui/switch";
import Section, { SettingRow } from "../settings-section";

export const AdvancedSettings = () => {
  const { settings, updateSetting, resetToDefaults } = useSettingsStore();
  const { showToast } = useToast();

  const handleResetSettings = () => {
    if (
      window.confirm(
        "Are you sure you want to reset all settings to their defaults? This cannot be undone.",
      )
    ) {
      resetToDefaults();
      showToast({ message: "Settings reset to defaults", type: "success" });
    }
  };

  return (
    <div className="space-y-4">
      <Section title="Telemetry">
        <SettingRow
          label="Usage Analytics"
          description="Send anonymous usage data (app version, platform) to help improve Athas. No personal data is collected."
        >
          <Switch
            checked={settings.telemetry}
            onChange={(checked) => updateSetting("telemetry", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Data">
        <SettingRow label="Reset Settings" description="Reset all settings to their default values">
          <Button
            variant="outline"
            size="xs"
            onClick={handleResetSettings}
            className="text-error hover:bg-error/10"
          >
            Reset
          </Button>
        </SettingRow>
      </Section>
    </div>
  );
};
