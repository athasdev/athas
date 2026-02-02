import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/store";
import Button from "@/ui/button";
import Section, { SettingRow } from "@/ui/section";

export const AdvancedSettings = () => {
  const { resetToDefaults } = useSettingsStore();
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
      <Section title="Data">
        <SettingRow label="Reset Settings" description="Reset all settings to their default values">
          <Button
            variant="outline"
            size="xs"
            onClick={handleResetSettings}
            className="text-red-500 hover:bg-red-500/10"
          >
            Reset
          </Button>
        </SettingRow>
      </Section>
    </div>
  );
};
