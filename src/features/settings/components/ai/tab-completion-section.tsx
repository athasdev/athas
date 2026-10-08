import { ModelConnectionPicker } from "@/features/ai/components/selectors/model-connection-picker";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { useTabCompletionModel } from "@/features/ai/hooks/use-tab-completion-model";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import Badge from "@/ui/badge";
import Switch from "@/ui/switch";
import Section, { SettingRow } from "../settings-section";

const AUTOMATIC = "Automatic";

/**
 * Tab completion has its own model. On Automatic it uses Athas's Tab model, or the default model
 * when it runs locally or when Athas is not available, so a local setup never sends code to Athas
 * without the user choosing it.
 */
export function TabCompletionSection() {
  const model = useTabCompletionModel();
  const updateSetting = useSettingsStore((store) => store.actions.updateSetting);
  const { allowed, enabled } = model;

  return (
    <Section title="Suggestions">
      <SettingRow
        label="Tab completion"
        description={allowed ? undefined : "Turned off by your organization"}
        onReset={() => updateSetting("aiCompletion", getDefaultSetting("aiCompletion"))}
        canReset={enabled !== getDefaultSetting("aiCompletion")}
      >
        <Switch
          checked={allowed ? enabled : false}
          onChange={(checked) => updateSetting("aiCompletion", checked)}
          disabled={!allowed}
        />
      </SettingRow>
      <SettingRow
        label="Model"
        control="select"
        labelAccessory={
          allowed && enabled && !model.resolved ? (
            <Badge tone="warning">Off until chosen</Badge>
          ) : null
        }
        description={model.description}
      >
        <ModelConnectionPicker
          aria-label="Tab completion model"
          purpose="completion"
          width="full"
          value={model.choice}
          inheritLabel={AUTOMATIC}
          onChange={model.change}
          disabled={model.locked || !allowed || !enabled}
        />
      </SettingRow>
    </Section>
  );
}
