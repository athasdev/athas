import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import Section, { SettingRow } from "../settings-section";
import Switch from "@/ui/switch";
import { createCoreFeaturesList } from "../../config/features";
import type { CoreFeature } from "../../types/feature";

export const FeaturesSettings = () => {
  const { settings, updateSetting } = useSettingsStore();

  const defaultCoreFeatures = getDefaultSetting("coreFeatures");

  // Create core features list
  const coreFeaturesList = createCoreFeaturesList(settings.coreFeatures).filter(
    (feature: CoreFeature) => feature.id !== "git",
  );

  // Handle core feature toggle
  const handleCoreFeatureToggle = (featureId: string, enabled: boolean) => {
    updateSetting("coreFeatures", {
      ...settings.coreFeatures,
      [featureId]: enabled,
    });
  };

  const handleResetFeature = (featureId: string) => {
    updateSetting("coreFeatures", {
      ...settings.coreFeatures,
      [featureId]: defaultCoreFeatures[featureId as keyof typeof defaultCoreFeatures],
    });
  };

  return (
    <div className="space-y-4">
      <Section title="Features" description="Toggle application features on or off">
        {coreFeaturesList.map((feature: CoreFeature) => (
          <SettingRow
            key={feature.id}
            label={feature.name}
            description={feature.description}
            onReset={() => handleResetFeature(feature.id)}
            canReset={
              feature.enabled !==
              defaultCoreFeatures[feature.id as keyof typeof defaultCoreFeatures]
            }
          >
            <Switch
              checked={feature.enabled}
              onChange={(checked) => handleCoreFeatureToggle(feature.id, checked)}
              size="sm"
            />
          </SettingRow>
        ))}
      </Section>
    </div>
  );
};
