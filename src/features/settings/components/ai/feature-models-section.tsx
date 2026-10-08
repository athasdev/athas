import { useState } from "react";
import { ModelConnectionPicker } from "@/features/ai/components/selectors/model-connection-picker";
import { useAIModelSettings } from "@/features/settings/hooks/use-ai-model-settings";
import { useSettingsSectionTarget } from "@/features/settings/hooks/use-settings-section-target";
import {
  AI_FEATURE_MODEL_OVERRIDES,
  countTaskOverrides,
  withTaskConnection,
} from "@/features/settings/services/ai-model-preferences";
import { Button } from "@/ui/button";
import { ChevronDownIcon, ChevronRightIcon } from "@/ui/icons";
import Section, { SettingRow } from "../settings-section";

const SECTION_TITLE = "Other features";
const SAME_AS_DEFAULT = "Same as default";

/**
 * Per-feature models, folded away until asked for: most people never change them. It opens on
 * its own when a feature already has its own model, or when Settings search points at it.
 */
export function FeatureModelsSection() {
  const state = useAIModelSettings();
  const overrideCount = countTaskOverrides(
    state.preferences,
    AI_FEATURE_MODEL_OVERRIDES.map(({ task }) => task),
  );
  const targeted = useSettingsSectionTarget(SECTION_TITLE);
  const [open, setOpen] = useState(overrideCount > 0 || targeted);
  const [wasTargeted, setWasTargeted] = useState(targeted);

  if (targeted !== wasTargeted) {
    setWasTargeted(targeted);
    if (targeted) setOpen(true);
  }

  return (
    <Section title={SECTION_TITLE}>
      <SettingRow
        label="Models per feature"
        description={
          overrideCount > 0 ? `${overrideCount} with their own model` : "All use the default model"
        }
      >
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          <span>{open ? "Hide" : "Show"}</span>
        </Button>
      </SettingRow>
      {open
        ? AI_FEATURE_MODEL_OVERRIDES.map(({ task, label }) => (
            <SettingRow key={task} label={label} level="nested" control="select">
              <ModelConnectionPicker
                aria-label={`${label} model`}
                width="full"
                value={state.preferences.tasks[task] ?? null}
                inheritLabel={SAME_AS_DEFAULT}
                onChange={(connection) =>
                  state.actions.change(withTaskConnection(state.preferences, task, connection))
                }
                disabled={state.locked}
              />
            </SettingRow>
          ))
        : null}
    </Section>
  );
}
