import { useState } from "react";
import { useIntelligenceSettingsStore } from "@/features/ai/intelligence/stores/intelligence-settings.store";
import type { IntelligenceConnection } from "@/features/ai/intelligence/types/intelligence.types";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { Button } from "@/ui/button";
import Section, { SettingRow } from "./settings-section";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import { ChevronDownIcon } from "@/ui/icons";

const tasks = [
  ["agent", "Agent default (new sessions)"],
  ["autocomplete", "Code autocomplete"],
  ["inline-edit", "Inline edits"],
  ["commit-message", "Commit messages"],
  ["chat-title", "Chat titles"],
  ["terminal-title", "Terminal titles"],
  ["github-draft", "GitHub drafts"],
  ["review-summary", "Review summaries"],
  ["review-insight", "Review assistance"],
] as const;

export function IntelligencePreferences({
  onConfigureProviders,
}: {
  onConfigureProviders: () => void;
}) {
  const state = useIntelligenceSettingsStore();
  const providers = useAvailableProviders();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const editable = state.scopes.find((scope) => scope.id === state.scope)?.canEdit ?? false;
  const options = [
    { value: "auto", label: "Athas Automatic" },
    ...providers
      .filter((provider) => provider.id !== "athas")
      .map((provider) => ({
        value: provider.id,
        label: provider.name,
      })),
  ];
  const renderConnection = (
    label: string,
    value: IntelligenceConnection | undefined,
    onChange: (connection: IntelligenceConnection | undefined) => void,
    inherit = false,
  ) => {
    const providerOptions = [
      ...(inherit ? [{ value: "inherit", label: "Use default" }] : []),
      ...options,
    ];
    if (value && !providerOptions.some((option) => option.value === value.providerId))
      providerOptions.push({ value: value.providerId, label: value.providerId });
    return (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <Select
          aria-label={`${label} provider`}
          value={value?.providerId ?? "inherit"}
          options={providerOptions}
          disabled={state.loading || !editable}
          onChange={(providerId) =>
            onChange(providerId === "inherit" ? undefined : { providerId, modelId: "" })
          }
        />
        {value && !["auto", "athas"].includes(value.providerId) ? (
          <Input
            aria-label={`${label} model`}
            placeholder="Model ID"
            value={value.modelId}
            disabled={state.loading || !editable}
            onChange={(event) => onChange({ ...value, modelId: event.target.value })}
          />
        ) : null}
      </div>
    );
  };

  return (
    <Section
      title="Intelligence"
      description="Athas chooses models for Agent, completions, edits, and titles. Use your own provider when you prefer."
    >
      {state.scopes.length > 1 ? (
        <SettingRow
          label="Settings for"
          description={
            state.userId === null
              ? "Saved on this device. Sign in to sync personal and team preferences."
              : "Preferences sync with your account and web dashboard."
          }
        >
          <Select
            aria-label="Intelligence settings scope"
            value={state.scope}
            options={state.scopes.map((scope) => ({ value: scope.id, label: scope.name }))}
            disabled={state.loading}
            onChange={(scope) => void state.actions.setScope(scope)}
          />
        </SettingRow>
      ) : null}
      <SettingRow
        label="Connection"
        description="Athas Automatic uses your Pro access. Personal provider keys stay on this device."
      >
        {renderConnection(
          "Default",
          state.preferences.defaultConnection,
          (connection) =>
            connection &&
            state.actions.change({ ...state.preferences, defaultConnection: connection }),
        )}
      </SettingRow>
      <SettingRow
        label="Own provider"
        description="Configure a provider key, local model, or custom endpoint."
      >
        <Button onClick={onConfigureProviders}>Configure provider</Button>
      </SettingRow>
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger render={<Button variant="ghost" width="full" align="between" />}>
          Per-feature overrides
          {Object.keys(state.preferences.tasks).length
            ? ` (${Object.keys(state.preferences.tasks).length})`
            : ""}
          <ChevronDownIcon />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {tasks.map(([task, label]) => (
            <SettingRow key={task} label={label}>
              {renderConnection(
                label,
                state.preferences.tasks[task],
                (connection) => {
                  const next = { ...state.preferences.tasks };
                  if (connection) next[task] = connection;
                  else delete next[task];
                  state.actions.change({ ...state.preferences, tasks: next });
                },
                true,
              )}
            </SettingRow>
          ))}
        </CollapsibleContent>
      </Collapsible>
      {state.dirty || state.error ? (
        <SettingRow
          label={state.userId === null ? "Local preferences" : "Account sync"}
          description={
            state.error ||
            (state.dirty ? "You have changes saved on this device." : "Preferences saved.")
          }
        >
          <div className="flex gap-2">
            <Button
              disabled={state.loading || !state.dirty || !editable}
              onClick={() => void state.actions.save()}
            >
              Save
            </Button>
            {state.userId !== null ? (
              <Button disabled={state.loading} onClick={() => void state.actions.refresh(true)}>
                Reload saved
              </Button>
            ) : null}
          </div>
        </SettingRow>
      ) : null}
    </Section>
  );
}
