import Section, { SettingRow } from "@/components/ui/section";
import Switch from "@/components/ui/switch";
import { useSettingsStore } from "@/settings/store";
import { createCoreFeaturesList } from "../../config/features";
import type { CoreFeature } from "../../models/feature.types";

export const FeaturesSettings = () => {
  const { settings, updateSetting } = useSettingsStore();

  // Create core features list
  const coreFeaturesList = createCoreFeaturesList(settings.coreFeatures);

  // Handle core feature toggle
  const handleCoreFeatureToggle = (featureId: string, enabled: boolean) => {
    updateSetting("coreFeatures", {
      ...settings.coreFeatures,
      [featureId]: enabled,
    });
  };

  return (
    <div className="space-y-4">
      <Section title="Features" description="Toggle application features on or off">
        {coreFeaturesList.map((feature: CoreFeature) => (
          <SettingRow key={feature.id} label={feature.name} description={feature.description}>
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
